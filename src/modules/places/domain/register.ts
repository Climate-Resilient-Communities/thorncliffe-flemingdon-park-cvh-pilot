/**
 * The City of Toronto's Apartment Building Registration as the pilot uses it (S01.13, AD-25): which
 * rows are the pilot's 43 buildings, whether every one of them can be loaded, and what is loaded.
 * Pure: no files, no database, no clock. The seed (application/importBuildings.ts) writes the plan;
 * one invalid row means nothing is written at all.
 *
 * The register extract (data/seed/apartment_building_reg.geojson) has one Point feature per
 * building. The fields used are:
 *  - `PCODE`: the postal area (forward sortation area) of the building. The pilot is the rows whose
 *    area is M4H (Thorncliffe Park, 32 buildings) or M3C (Flemingdon Park, 11): 43 in all;
 *  - `RSN`: the registration number, the building's key (a whole number);
 *  - `SITE_ADDRESS`: the address, with the register's doubled spaces and capital letters;
 *  - the geometry (`LONGITUDE` and `LATITUDE` when the geometry is missing);
 *  - the D4-P facts (PRD 7.3): `CONFIRMED_STOREYS` (storeys), `NO_OF_ELEVATORS`,
 *    `IS_THERE_EMERGENCY_POWER`, `IS_THERE_A_COOLING_ROOM`, `AIR_CONDITIONING_TYPE` and
 *    `BARRIER_FREE_ACCESSIBILTY_ENTR` (spelled so in the register). The register also carries
 *    duplicate, empty variants of some columns (`NO_OF_STOREYS`, `IS_THERE_EMERGENCY_POWER?`, ...):
 *    they are ignored.
 * A fact the register leaves blank, or gives in a form that is not understood, is "not known" (null),
 * and the second case is a warning.
 */

/** A neighbourhood of the pilot, and the postal area that defines it. */
export interface PilotArea {
  fsa: string;
  neighbourhoodId: string;
  name: string;
  /** How many buildings the register is expected to list there (PRD 5; a different count is a warning, not a refusal). */
  expected: number;
}

export const PILOT_AREAS: readonly PilotArea[] = [
  { fsa: "M4H", neighbourhoodId: "TP", name: "Thorncliffe Park", expected: 32 },
  { fsa: "M3C", neighbourhoodId: "FP", name: "Flemingdon Park", expected: 11 },
];

/**
 * The box a building's coordinates must fall in. The City of Toronto spans roughly 43.58 to 43.86
 * degrees north and 79.64 to 79.12 degrees west; the box adds about two kilometres of margin all
 * round. It catches the usual data mistakes: latitude and longitude swapped, a missing sign, a
 * point at 0,0 or in another city. It does not check that a point is in the right neighbourhood.
 */
export const TORONTO_BOUNDS = { minLatitude: 43.55, maxLatitude: 43.88, minLongitude: -79.66, maxLongitude: -79.1 } as const;

/** A register feature as read from the GeoJSON file: anything, since the file is not trusted. */
export type RegisterFeature = unknown;

/** One line of data/seed/building-merge.csv: `rsn` is the same building as `primaryRsn`. */
export interface MergeEntry {
  /** The line of the file, counting from 1. */
  line: number;
  rsn: string;
  primaryRsn: string;
}

/** Something wrong with a row of the register or of the merge file. */
export interface PlanProblem {
  source: "register" | "merge" | "database";
  /** The feature's position in the register (the first feature is 1), or the merge file's line; null when it is about several rows. */
  row: number | null;
  rsn: string | null;
  address: string | null;
  message: string;
}

/** A building as the import loads it. */
export interface PlannedBuilding {
  rsn: string;
  fsa: string;
  neighbourhoodId: string;
  address: string;
  latitude: number;
  longitude: number;
  storeys: number | null;
  elevators: number | null;
  emergencyPower: boolean | null;
  coolingRoom: boolean | null;
  airConditioning: string | null;
  barrierFreeEntrance: boolean | null;
  /** The other registrations the merge file maps to this building. */
  mergedRsns: string[];
}

export interface ImportPlan {
  buildings: PlannedBuilding[];
  failures: PlanProblem[];
  warnings: PlanProblem[];
  counts: {
    /** Features in the register file. */
    features: number;
    /** Rows of the pilot's postal areas, before the merge file is applied. */
    pilotRows: number;
    pilotRowsByFsa: Record<string, number>;
    /** Rows of other postal areas: not loaded. */
    outsidePilot: number;
    /** Pilot rows the merge file folds into another building. */
    merged: number;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The register's text fields: trimmed, with runs of white space made single; null when empty or not text. */
function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed === "" ? null : collapsed;
}

/** The postal area of a PCODE value: its first three characters, upper case. */
export function fsaOf(value: unknown): string | null {
  const text = textOf(value);
  return text === null ? null : text.replace(/\s/g, "").toUpperCase().slice(0, 3);
}

const RSN_PATTERN = /^[0-9]{1,9}$/;

/** A registration number from a number or text; null when it is not a whole number of 1 to 9 digits. */
export function rsnOf(value: unknown): string | null {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? rsnOf(String(value)) : null;
  const text = textOf(value);
  return text !== null && RSN_PATTERN.test(text) && Number(text) > 0 ? String(Number(text)) : null;
}

/**
 * The register's capitals made readable: "85-95  THORNCLIFFE PARK DR " becomes "85-95 Thorncliffe
 * Park Dr". A word that starts with a digit is left as written ("85-95", "2A").
 */
export function tidyAddress(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (/^[0-9]/.test(word) ? word : word.toLowerCase().replace(/(^|[-'])([a-z])/g, (_, edge: string, letter: string) => edge + letter.toUpperCase())))
    .join(" ");
}

/** Two addresses are the same when they are equal ignoring case and runs of spaces. */
const addressKey = (address: string) => address.toUpperCase().replace(/\s+/g, " ").trim();

/** Where the point is: the geometry's, or the LONGITUDE and LATITUDE columns when there is no usable geometry. */
function coordinatesOf(feature: Record<string, unknown>, props: Record<string, unknown>): { latitude: number; longitude: number } | null {
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const geometry = feature.geometry;
  if (isRecord(geometry) && geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    const longitude = number(geometry.coordinates[0]);
    const latitude = number(geometry.coordinates[1]);
    if (latitude !== null && longitude !== null) return { latitude, longitude };
  }
  const longitude = number(props.LONGITUDE);
  const latitude = number(props.LATITUDE);
  return latitude !== null && longitude !== null ? { latitude, longitude } : null;
}

export const insideToronto = ({ latitude, longitude }: { latitude: number; longitude: number }): boolean =>
  latitude >= TORONTO_BOUNDS.minLatitude && latitude <= TORONTO_BOUNDS.maxLatitude && longitude >= TORONTO_BOUNDS.minLongitude && longitude <= TORONTO_BOUNDS.maxLongitude;

/** The register's last word on the six facts: what is understood, and what is a warning. */
function readFacts(props: Record<string, unknown>, warn: (message: string) => void) {
  const yesNo = (field: string): boolean | null => {
    const text = textOf(props[field]);
    if (text === null) return null;
    const upper = text.toUpperCase();
    if (upper === "YES") return true;
    if (upper === "NO") return false;
    warn(`${field} is "${text}", not YES or NO: kept as not known`);
    return null;
  };
  const whole = (field: string, min: number, max: number): number | null => {
    const value = props[field];
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (!Number.isInteger(number) || number < min || number > max) {
      warn(`${field} is ${JSON.stringify(value)}, not a whole number from ${min} to ${max}: kept as not known`);
      return null;
    }
    return number;
  };
  const air = textOf(props.AIR_CONDITIONING_TYPE);
  return {
    storeys: whole("CONFIRMED_STOREYS", 1, 150),
    elevators: whole("NO_OF_ELEVATORS", 0, 99),
    emergencyPower: yesNo("IS_THERE_EMERGENCY_POWER"),
    coolingRoom: yesNo("IS_THERE_A_COOLING_ROOM"),
    airConditioning: air === null ? null : air.charAt(0).toUpperCase() + air.slice(1).toLowerCase(),
    barrierFreeEntrance: yesNo("BARRIER_FREE_ACCESSIBILTY_ENTR"),
  };
}

/**
 * Reads data/seed/building-merge.csv: `rsn,primary_rsn` with an optional third column of notes, a
 * header line, and blank lines and lines starting with # ignored. `rsn` is a registration that is
 * the same building as `primary_rsn` (for example the register's second entry for "85-95
 * Thorncliffe Park Dr"); only the primary is loaded. A line that cannot be read is a failure.
 */
export function parseMergeFile(text: string): { entries: MergeEntry[]; failures: PlanProblem[] } {
  const entries: MergeEntry[] = [];
  const failures: PlanProblem[] = [];
  let sawHeader = false;
  for (const [index, raw] of text.replace(/^﻿/, "").split(/\r?\n/).entries()) {
    const line = index + 1;
    const content = raw.trim();
    if (content === "" || content.startsWith("#")) continue;
    const cells = content.split(",").map((cell) => cell.trim());
    if (!sawHeader) {
      sawHeader = true;
      if (cells[0].toLowerCase() === "rsn" && cells[1]?.toLowerCase() === "primary_rsn") continue;
      failures.push({ source: "merge", row: line, rsn: null, address: null, message: 'the first line must be the header "rsn,primary_rsn"' });
      continue;
    }
    const rsn = rsnOf(cells[0]);
    const primaryRsn = rsnOf(cells[1]);
    if (rsn === null || primaryRsn === null) {
      failures.push({ source: "merge", row: line, rsn: rsn ?? null, address: null, message: "rsn and primary_rsn must both be registration numbers (whole numbers)" });
      continue;
    }
    entries.push({ line, rsn, primaryRsn });
  }
  return { entries, failures };
}

/**
 * Decides what an import would load from the register's features and the merge file's entries.
 * `failures` lists every row that cannot be loaded (nothing is imported while there is one);
 * `warnings` lists what is loaded with a caution. Rows outside the pilot's postal areas are
 * skipped without a check: only the pilot's rows are validated.
 *
 * A pilot row fails when it has no registration number (`RSN`), no address, no coordinates or
 * coordinates outside TORONTO_BOUNDS, or when its registration number appears on another pilot
 * row (all of them fail). A merge entry fails when it maps a registration to itself, to one that
 * is not a pilot row, to one that is itself folded into another, or when a registration is
 * mapped twice. A merge entry for a registration that is not a pilot row is only a warning.
 * A postal area with a different number of rows than PILOT_AREAS expects is a warning too (a
 * register can lose a building, which is flagged, not refused); `checkCounts: false` leaves that
 * out, for registers that are not the pilot's.
 */
export function planBuildingImport(features: readonly RegisterFeature[], merges: readonly MergeEntry[] = [], options: { checkCounts?: boolean } = {}): ImportPlan {
  const failures: PlanProblem[] = [];
  const warnings: PlanProblem[] = [];
  const counts: ImportPlan["counts"] = { features: features.length, pilotRows: 0, pilotRowsByFsa: Object.fromEntries(PILOT_AREAS.map((area) => [area.fsa, 0])), outsidePilot: 0, merged: 0 };
  const rows: { row: number; building: PlannedBuilding }[] = [];

  features.forEach((feature, index) => {
    const row = index + 1;
    if (!isRecord(feature) || !isRecord(feature.properties)) {
      failures.push({ source: "register", row, rsn: null, address: null, message: "the feature has no properties, so it cannot be told apart from a pilot row" });
      return;
    }
    const props = feature.properties;
    const area = PILOT_AREAS.find((candidate) => candidate.fsa === fsaOf(props.PCODE));
    if (!area) {
      counts.outsidePilot += 1;
      return;
    }
    counts.pilotRows += 1;
    counts.pilotRowsByFsa[area.fsa] += 1;

    const rsn = rsnOf(props.RSN);
    const addressText = textOf(props.SITE_ADDRESS);
    const address = addressText === null ? null : tidyAddress(addressText);
    const problem = (message: string) => failures.push({ source: "register", row, rsn, address, message });
    const caution = (message: string) => warnings.push({ source: "register", row, rsn, address, message });

    let valid = true;
    if (rsn === null) {
      problem(textOf(props.RSN) === null && typeof props.RSN !== "number" ? "missing rsn (RSN)" : `rsn (RSN) is ${JSON.stringify(props.RSN)}, not a whole number of up to 9 digits`);
      valid = false;
    }
    if (address === null) {
      problem("missing address (SITE_ADDRESS)");
      valid = false;
    }
    const point = coordinatesOf(feature, props);
    if (point === null) {
      problem("missing coordinates (geometry, LONGITUDE and LATITUDE)");
      valid = false;
    } else if (!insideToronto(point)) {
      problem(`coordinates ${point.latitude}, ${point.longitude} (latitude, longitude) are outside Toronto (${TORONTO_BOUNDS.minLatitude} to ${TORONTO_BOUNDS.maxLatitude} north, ${TORONTO_BOUNDS.minLongitude} to ${TORONTO_BOUNDS.maxLongitude})`);
      valid = false;
    }
    if (!valid || rsn === null || address === null || point === null) return;

    const facts = readFacts(props, caution);
    if (facts.storeys === null) caution("no confirmed storeys (CONFIRMED_STOREYS): the building is loaded without floors; add them by hand");
    rows.push({
      row,
      building: { rsn, fsa: area.fsa, neighbourhoodId: area.neighbourhoodId, address, latitude: point.latitude, longitude: point.longitude, ...facts, mergedRsns: [] },
    });
  });

  // The same registration number twice: every row that has it fails.
  const byRsn = new Map<string, number[]>();
  for (const { row, building } of rows) byRsn.set(building.rsn, [...(byRsn.get(building.rsn) ?? []), row]);
  const repeated = new Set<string>();
  for (const [rsn, at] of byRsn) {
    if (at.length < 2) continue;
    repeated.add(rsn);
    for (const row of at) {
      const building = rows.find((candidate) => candidate.row === row)!.building;
      failures.push({ source: "register", row, rsn, address: building.address, message: `rsn ${rsn} appears ${at.length} times in the pilot rows (rows ${at.join(", ")})` });
    }
  }

  for (const area of options.checkCounts === false ? [] : PILOT_AREAS) {
    if (counts.pilotRowsByFsa[area.fsa] !== area.expected) {
      warnings.push({ source: "register", row: null, rsn: null, address: null, message: `${area.fsa} (${area.name}) has ${counts.pilotRowsByFsa[area.fsa]} rows in the register; ${area.expected} were expected` });
    }
  }

  // The merge file.
  const pilotRsns = new Set(rows.map(({ building }) => building.rsn));
  const mappedFrom = new Set<string>();
  const folded = new Map<string, string>();
  for (const entry of merges) {
    const mergeProblem = (message: string) => failures.push({ source: "merge", row: entry.line, rsn: entry.rsn, address: null, message });
    if (entry.rsn === entry.primaryRsn) {
      mergeProblem("a registration cannot be mapped to itself");
    } else if (mappedFrom.has(entry.rsn)) {
      mergeProblem(`rsn ${entry.rsn} is mapped more than once`);
    } else if (!pilotRsns.has(entry.primaryRsn)) {
      mergeProblem(`the primary rsn ${entry.primaryRsn} is not a pilot row of the register`);
    } else if (!pilotRsns.has(entry.rsn)) {
      warnings.push({ source: "merge", row: entry.line, rsn: entry.rsn, address: null, message: `rsn ${entry.rsn} is not a pilot row of the register: the line is ignored` });
    } else {
      folded.set(entry.rsn, entry.primaryRsn);
    }
    mappedFrom.add(entry.rsn);
  }
  for (const [rsn, primary] of folded) {
    if (folded.has(primary)) {
      const line = merges.find((entry) => entry.rsn === rsn)!.line;
      failures.push({ source: "merge", row: line, rsn, address: null, message: `the primary rsn ${primary} is itself mapped to another building` });
      folded.delete(rsn);
    }
  }

  const buildings: PlannedBuilding[] = [];
  for (const { building } of rows) {
    if (repeated.has(building.rsn)) continue;
    if (folded.has(building.rsn)) {
      counts.merged += 1;
      continue;
    }
    buildings.push(building);
  }
  for (const [rsn, primary] of folded) buildings.find((building) => building.rsn === primary)?.mergedRsns.push(rsn);

  // The same address under different registration numbers, and not mapped together: kept apart, with a warning.
  const byAddress = new Map<string, PlannedBuilding[]>();
  for (const building of buildings) byAddress.set(addressKey(building.address), [...(byAddress.get(addressKey(building.address)) ?? []), building]);
  for (const group of byAddress.values()) {
    if (group.length < 2) continue;
    const rsns = group.map((building) => building.rsn);
    warnings.push({
      source: "register",
      row: null,
      rsn: null,
      address: group[0].address,
      message: `${group.length} registrations share this address (rsn ${rsns.join(", ")}): kept as ${group.length} buildings; to make them one, map the others to a primary rsn in data/seed/building-merge.csv`,
    });
  }

  return { buildings, failures: sortProblems(failures), warnings: sortProblems(warnings), counts };
}

const SOURCE_ORDER = { register: 0, merge: 1, database: 2 } as const;

function sortProblems(problems: PlanProblem[]): PlanProblem[] {
  return [...problems].sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || (a.row ?? Number.MAX_SAFE_INTEGER) - (b.row ?? Number.MAX_SAFE_INTEGER));
}

/** A problem as one report line. */
export function formatProblem(problem: PlanProblem): string {
  const where =
    problem.source === "merge"
      ? `building-merge.csv line ${problem.row}`
      : problem.source === "database"
        ? "database"
        : problem.row === null
          ? "register"
          : `register row ${problem.row}`;
  const who = [problem.rsn ? `rsn ${problem.rsn}` : null, problem.address].filter(Boolean).join(", ");
  return `${where}${who ? ` (${who})` : ""}: ${problem.message}`;
}
