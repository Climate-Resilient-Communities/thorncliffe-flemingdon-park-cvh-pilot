import { describe, expect, it } from "vitest";
import { formatImportReport } from "./importReport";
import { PILOT_AREAS, TORONTO_BOUNDS, formatProblem, fsaOf, parseMergeFile, planBuildingImport as plan43, rsnOf, tidyAddress } from "./register";

/** A small register: no count of buildings expected. */
const planBuildingImport = (features: Parameters<typeof plan43>[0], merges?: Parameters<typeof plan43>[1]) => plan43(features, merges, { checkCounts: false });

/** A register feature of the pilot (M4H), with the fields the import reads; `props` overrides any of them. */
function feature(props: Record<string, unknown> = {}, geometry: unknown = undefined) {
  const base = {
    RSN: 100,
    PCODE: "M4H",
    SITE_ADDRESS: "1  TEST ST ",
    CONFIRMED_STOREYS: 6,
    NO_OF_ELEVATORS: 2.0,
    IS_THERE_EMERGENCY_POWER: "YES",
    IS_THERE_A_COOLING_ROOM: "NO",
    AIR_CONDITIONING_TYPE: "NONE",
    BARRIER_FREE_ACCESSIBILTY_ENTR: "YES",
    LONGITUDE: -79.34,
    LATITUDE: 43.7,
    ...props,
  };
  return { type: "Feature", properties: base, geometry: geometry === undefined ? { type: "Point", coordinates: [base.LONGITUDE, base.LATITUDE] } : geometry };
}

/** 32 M4H and 11 M3C features with distinct rsns and addresses. */
function pilotRegister() {
  return [
    ...Array.from({ length: 32 }, (_, i) => feature({ RSN: 1000 + i, PCODE: "M4H", SITE_ADDRESS: `${i + 1} TP ST` })),
    ...Array.from({ length: 11 }, (_, i) => feature({ RSN: 2000 + i, PCODE: "M3C", SITE_ADDRESS: `${i + 1} FP ST`, LONGITUDE: -79.33, LATITUDE: 43.71 })),
  ];
}

describe("planning an import", () => {
  it("loads 43 buildings of a register with 32 and 11 pilot rows, warning about nothing", () => {
    const plan = plan43([...pilotRegister(), feature({ RSN: 9, PCODE: "M4A", LATITUDE: 0, LONGITUDE: 0 })]);
    expect(plan.failures).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.buildings).toHaveLength(43);
    expect(plan.counts.outsidePilot).toBe(1);
  });

  it("does not check the rows outside the pilot", () => {
    const plan = plan43([feature({ RSN: null, PCODE: "M1R", SITE_ADDRESS: null, LATITUDE: 0, LONGITUDE: 0 }), feature({ PCODE: null }), ...pilotRegister()]);
    expect(plan.failures).toEqual([]);
    expect(plan.counts.outsidePilot).toBe(2);
  });

  it("warns, without failing, when a postal area has a different number of rows than expected", () => {
    const plan = plan43(pilotRegister().slice(1));
    expect(plan.failures).toEqual([]);
    expect(plan.warnings.map((w) => w.message)).toEqual(["M4H (Thorncliffe Park) has 31 rows in the register; 32 were expected"]);
    expect(plan.buildings).toHaveLength(42);
  });

  it("reads the postal area and rsn however the register spells them", () => {
    expect(fsaOf(" m4h ")).toBe("M4H");
    expect(fsaOf("M3C 1A1")).toBe("M3C");
    expect(fsaOf(null)).toBeNull();
    expect(rsnOf(4154146)).toBe("4154146");
    expect(rsnOf(" 4154146 ")).toBe("4154146");
    for (const bad of [null, "", "abc", 1.5, -3, 0, "12345678901", true]) expect(rsnOf(bad), String(bad)).toBeNull();
  });

  it("makes the register's capitals and doubled spaces readable", () => {
    expect(tidyAddress("85-95  THORNCLIFFE PARK DR ")).toBe("85-95 Thorncliffe Park Dr");
    expect(tidyAddress("7  ST DENNIS DR ")).toBe("7 St Dennis Dr");
    expect(tidyAddress("10 O'CONNOR DR")).toBe("10 O'Connor Dr");
    expect(tidyAddress("2A  MILEPOST PL")).toBe("2A Milepost Pl");
  });

  it("uses the coordinates columns when the geometry is missing, and fails when there are none", () => {
    expect(planBuildingImport([feature({}, null)]).buildings[0]).toMatchObject({ latitude: 43.7, longitude: -79.34 });
    const plan = planBuildingImport([feature({ LATITUDE: null, LONGITUDE: null }, null)]);
    expect(plan.failures.map((f) => f.message)).toEqual(["missing coordinates (geometry, LONGITUDE and LATITUDE)"]);
  });

  it("keeps a fact the register does not give as not known, and warns about one it does not understand", () => {
    const plan = planBuildingImport([feature({ NO_OF_ELEVATORS: null, IS_THERE_A_COOLING_ROOM: "", IS_THERE_EMERGENCY_POWER: "MAYBE", CONFIRMED_STOREYS: "6", AIR_CONDITIONING_TYPE: null })]);
    expect(plan.failures).toEqual([]);
    expect(plan.buildings[0]).toMatchObject({ elevators: null, coolingRoom: null, emergencyPower: null, storeys: 6, airConditioning: null });
    expect(plan.warnings.map((w) => w.message)).toEqual(['IS_THERE_EMERGENCY_POWER is "MAYBE", not YES or NO: kept as not known']);
  });

  it("loads a building with no confirmed storeys, without floors, and says so", () => {
    for (const storeys of [null, 0, 2.5, "tall", 999]) {
      const plan = planBuildingImport([feature({ CONFIRMED_STOREYS: storeys })]);
      expect(plan.failures, String(storeys)).toEqual([]);
      expect(plan.buildings[0].storeys, String(storeys)).toBeNull();
      expect(plan.warnings.at(-1)?.message, String(storeys)).toContain("no confirmed storeys");
    }
  });
});

describe("a row that fails", () => {
  const failing = (props: Record<string, unknown>, geometry?: unknown) => planBuildingImport([feature(props, geometry)]).failures;

  it("lists a missing rsn", () => {
    for (const RSN of [null, "", "  ", undefined]) {
      const failures = failing({ RSN });
      expect(failures, String(RSN)).toHaveLength(1);
      expect(failures[0]).toMatchObject({ source: "register", row: 1, rsn: null, message: "missing rsn (RSN)" });
    }
    expect(failing({ RSN: "12ab" })[0].message).toBe('rsn (RSN) is "12ab", not a whole number of up to 9 digits');
  });

  it("lists coordinates outside Toronto, however they are wrong", () => {
    const outside: [string, number, number][] = [
      ["swapped", 43.7, -79.34],
      ["at the origin", 0, 0],
      ["a missing sign", 79.34, 43.7],
      ["another city (Ottawa)", -75.7, 45.42],
      ["north of the box", -79.34, TORONTO_BOUNDS.maxLatitude + 0.001],
      ["west of the box", TORONTO_BOUNDS.minLongitude - 0.001, 43.7],
    ];
    for (const [name, longitude, latitude] of outside) {
      const failures = failing({ LONGITUDE: longitude, LATITUDE: latitude });
      expect(failures, name).toHaveLength(1);
      expect(failures[0].message, name).toContain("are outside Toronto");
    }
  });

  it("accepts the corners of the box", () => {
    for (const [longitude, latitude] of [
      [TORONTO_BOUNDS.minLongitude, TORONTO_BOUNDS.minLatitude],
      [TORONTO_BOUNDS.maxLongitude, TORONTO_BOUNDS.maxLatitude],
    ]) {
      expect(failing({ LONGITUDE: longitude, LATITUDE: latitude })).toEqual([]);
    }
  });

  it("lists a missing address", () => {
    expect(failing({ SITE_ADDRESS: "   " }).map((f) => f.message)).toEqual(["missing address (SITE_ADDRESS)"]);
  });

  it("lists every problem of a row and every failing row, not just the first", () => {
    const plan = plan43([feature({ RSN: null, LATITUDE: 0, LONGITUDE: 0 }), ...pilotRegister(), feature({ RSN: 7, SITE_ADDRESS: null })]);
    expect(plan.failures.map((f) => [f.row, f.message.split(" ")[0]])).toEqual([
      [1, "missing"],
      [1, "coordinates"],
      [45, "missing"],
    ]);
  });

  it("fails every row of an rsn that appears twice", () => {
    const plan = planBuildingImport([feature({ RSN: 55, SITE_ADDRESS: "1 A ST" }), feature({ RSN: 56, SITE_ADDRESS: "2 B ST" }), feature({ RSN: 55, SITE_ADDRESS: "3 C ST" }), feature({ RSN: 55, PCODE: "M3C", SITE_ADDRESS: "4 D ST" })]);
    expect(plan.failures.map((f) => [f.row, f.rsn, f.message])).toEqual([
      [1, "55", "rsn 55 appears 3 times in the pilot rows (rows 1, 3, 4)"],
      [3, "55", "rsn 55 appears 3 times in the pilot rows (rows 1, 3, 4)"],
      [4, "55", "rsn 55 appears 3 times in the pilot rows (rows 1, 3, 4)"],
    ]);
    expect(plan.buildings.map((b) => b.rsn)).toEqual(["56"]);
  });

  it("fails a feature that is not a register row", () => {
    const plan = planBuildingImport([null, { type: "Feature" }, "x"]);
    expect(plan.failures).toHaveLength(3);
    expect(plan.failures.map((f) => f.row)).toEqual([1, 2, 3]);
  });

  it("is printed with its row, rsn and address", () => {
    const [failure] = failing({ RSN: 77, LATITUDE: 0, LONGITUDE: 0 });
    expect(formatProblem(failure)).toBe("register row 1 (rsn 77, 1 Test St): coordinates 0, 0 (latitude, longitude) are outside Toronto (43.55 to 43.88 north, -79.66 to -79.1)");
    const plan = planBuildingImport([feature({ RSN: 77, LATITUDE: 0, LONGITUDE: 0 })]);
    expect(formatImportReport(plan)).toContain("Failures (1): nothing was imported.");
    expect(formatImportReport(plan).some((line) => line.startsWith("Would load"))).toBe(false);
  });
});

describe("two registrations at one address", () => {
  const twins = () => [feature({ RSN: 1, SITE_ADDRESS: "85-95  THORNCLIFFE PARK DR " }), feature({ RSN: 2, SITE_ADDRESS: "85-95 Thorncliffe Park Dr" }), feature({ RSN: 3, SITE_ADDRESS: "9 OTHER ST" })];

  it("stay two buildings, with one warning, when the merge file does not map them", () => {
    const plan = planBuildingImport(twins());
    expect(plan.failures).toEqual([]);
    expect(plan.buildings.map((b) => b.rsn)).toEqual(["1", "2", "3"]);
    expect(plan.warnings.map((w) => w.message)).toEqual([expect.stringContaining("2 registrations share this address (rsn 1, 2): kept as 2 buildings")]);
  });

  it("become one building, with no warning, when the merge file maps one to the other", () => {
    const plan = planBuildingImport(twins(), [{ line: 2, rsn: "2", primaryRsn: "1" }]);
    expect(plan.failures).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.counts.merged).toBe(1);
    expect(plan.buildings.map((b) => [b.rsn, b.mergedRsns])).toEqual([
      ["1", ["2"]],
      ["3", []],
    ]);
  });

  it("are not hidden by a merge file that maps other rows", () => {
    const plan = planBuildingImport(twins(), [{ line: 2, rsn: "3", primaryRsn: "1" }]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.buildings.map((b) => b.rsn)).toEqual(["1", "2"]);
  });
});

describe("the merge file", () => {
  const register = () => [feature({ RSN: 1, SITE_ADDRESS: "1 A ST" }), feature({ RSN: 2, SITE_ADDRESS: "2 B ST" }), feature({ RSN: 3, SITE_ADDRESS: "3 C ST" }), feature({ RSN: 4, PCODE: "M1R", SITE_ADDRESS: "4 D ST" })];

  it("reads rsn,primary_rsn lines, ignoring comments, blank lines and extra columns", () => {
    const parsed = parseMergeFile("﻿rsn,primary_rsn,note\r\n# comment\r\n\r\n2, 1 ,same building\r\n3,1\r\n");
    expect(parsed.failures).toEqual([]);
    expect(parsed.entries).toEqual([
      { line: 4, rsn: "2", primaryRsn: "1" },
      { line: 5, rsn: "3", primaryRsn: "1" },
    ]);
  });

  it("reports every line it cannot read, with its line number", () => {
    const parsed = parseMergeFile("rsn,primary_rsn\n2,abc\nx,1\n,\n2,1\n");
    expect(parsed.entries).toEqual([{ line: 5, rsn: "2", primaryRsn: "1" }]);
    expect(parsed.failures.map((f) => f.row)).toEqual([2, 3, 4]);
    expect(parseMergeFile("2,1\n").failures[0].message).toContain("header");
    expect(parseMergeFile("").entries).toEqual([]);
  });

  it("fails a line that maps a registration to itself, twice, to a missing primary or through a chain", () => {
    const plan = planBuildingImport(register(), [
      { line: 2, rsn: "1", primaryRsn: "1" },
      { line: 3, rsn: "2", primaryRsn: "3" },
      { line: 4, rsn: "2", primaryRsn: "1" },
      { line: 5, rsn: "3", primaryRsn: "99" },
    ]);
    expect(plan.failures.map((f) => [f.source, f.row, f.message])).toEqual([
      ["merge", 2, "a registration cannot be mapped to itself"],
      ["merge", 4, "rsn 2 is mapped more than once"],
      ["merge", 5, "the primary rsn 99 is not a pilot row of the register"],
    ]);
    const chain = planBuildingImport(register(), [
      { line: 2, rsn: "2", primaryRsn: "3" },
      { line: 3, rsn: "3", primaryRsn: "1" },
    ]);
    expect(chain.failures.map((f) => [f.row, f.message])).toEqual([[2, "the primary rsn 3 is itself mapped to another building"]]);
  });

  it("only warns about a line for a registration that is not a pilot row", () => {
    const plan = planBuildingImport(register(), [
      { line: 2, rsn: "4", primaryRsn: "1" },
      { line: 3, rsn: "77", primaryRsn: "1" },
    ]);
    expect(plan.failures).toEqual([]);
    expect(plan.warnings.map((w) => w.message)).toEqual(["rsn 4 is not a pilot row of the register: the line is ignored", "rsn 77 is not a pilot row of the register: the line is ignored"]);
    expect(plan.buildings).toHaveLength(3);
  });
});

describe("the pilot's areas", () => {
  it("are the two named in the PRD, 32 and 11 buildings", () => {
    expect(PILOT_AREAS.map((a) => [a.fsa, a.neighbourhoodId, a.expected])).toEqual([
      ["M4H", "TP", 32],
      ["M3C", "FP", 11],
    ]);
  });
});
