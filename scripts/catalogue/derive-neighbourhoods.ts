// Derives data/catalogue/provider-neighbourhoods.json from the provider catalogue (S02.06). Run through
// scripts/catalogue/provider-neighbourhoods.mjs:
//
//   npm run derive:neighbourhoods [-- --dir <catalogue folder>] [-- --force]
//
// The directory's neighbourhood filter reads the neighbourhoods of each provider from the release file, and the release
// takes them from that JSON file, which ships with the app like the other catalogue files (the catalogue hash covers it).
// This script makes the first version of it from the providers' locations, once. The result is a default for the Hub to
// review: the file says "reviewed": false until the Hub has checked the list and changed it by hand. After that the
// script refuses to overwrite it (--force does, and sets "reviewed" back to false).
//
// The rule, from the places import's postal areas (src/modules/places/domain/register.ts PILOT_AREAS):
//   M4H (Thorncliffe Park)  -> ["TP"]
//   M3C (Flemingdon Park)   -> ["FP"], but only south of latitude 43.722: north of it is Don Mills / Wynford, which is
//                              in neither neighbourhood -> []
//   any other postal code, or none -> []
// A provider with several locations gets every neighbourhood any of them is in.
//
// Exit code 0: the file was written. 1: the catalogue could not be read, or the file is reviewed and --force was not given.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NEIGHBOURHOOD_IDS, type NeighbourhoodId } from "@/contracts/directory";
import { fsaOf, PILOT_AREAS } from "@/modules/places/domain/register";

export const OUTPUT_NAME = "provider-neighbourhoods.json";

/** Postal areas whose part north of this latitude belongs to neither neighbourhood. */
export const NORTH_LIMITS: Readonly<Record<string, number>> = { M3C: 43.722 };

export const NOTE =
  "Default derived from the providers' locations by npm run derive:neighbourhoods. NOT YET REVIEWED: the Hub must review this list " +
  "(which providers count as Thorncliffe Park, Flemingdon Park, both or neither) and then set reviewed to true. The directory's neighbourhood filter shows exactly this list.";

export const RULE =
  "M4H: TP. M3C: FP only south of latitude 43.722 (north of it is Don Mills / Wynford: none). Any other postal code, or none: none.";

export interface LocatedProvider {
  id: string;
  postal: string | null;
  lat: number;
}

/** The neighbourhoods one location is in. */
export function neighbourhoodOfLocation(postal: string | null, lat: number): NeighbourhoodId | null {
  const area = PILOT_AREAS.find((a) => a.fsa === fsaOf(postal));
  if (!area) return null;
  const limit = NORTH_LIMITS[area.fsa];
  if (limit !== undefined && !(lat < limit)) return null;
  return (NEIGHBOURHOOD_IDS as readonly string[]).includes(area.neighbourhoodId) ? (area.neighbourhoodId as NeighbourhoodId) : null;
}

/** provider id -> neighbourhoods, ids in order of the catalogue's ids, neighbourhoods in the order TP, FP. */
export function deriveNeighbourhoods(providers: readonly LocatedProvider[]): Record<string, NeighbourhoodId[]> {
  const found = new Map<string, Set<NeighbourhoodId>>();
  for (const { id, postal, lat } of providers) {
    const set = found.get(id) ?? new Set<NeighbourhoodId>();
    const one = neighbourhoodOfLocation(postal, lat);
    if (one) set.add(one);
    found.set(id, set);
  }
  return Object.fromEntries(
    [...found.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, set]) => [id, NEIGHBOURHOOD_IDS.filter((n) => set.has(n))]),
  );
}

/** The file's text: one provider per line, so the Hub's review reads as a list and a change is one line in a diff. */
export function fileText(providers: Record<string, readonly NeighbourhoodId[]>, reviewed = false): string {
  const lines = Object.entries(providers).map(([id, ids]) => `    ${JSON.stringify(id)}: ${JSON.stringify(ids)}`);
  return `{\n  "reviewed": ${reviewed},\n  "note": ${JSON.stringify(NOTE)},\n  "rule": ${JSON.stringify(RULE)},\n  "providers": {\n${lines.join(",\n")}\n  }\n}\n`;
}

/** How many providers are in each neighbourhood, in both, and in neither. */
export function countsOf(providers: Record<string, readonly NeighbourhoodId[]>) {
  const counts = { providers: 0, TP: 0, FP: 0, both: 0, none: 0 };
  for (const ids of Object.values(providers)) {
    counts.providers += 1;
    if (ids.length === 0) counts.none += 1;
    else if (ids.length === NEIGHBOURHOOD_IDS.length) counts.both += 1;
    else counts[ids[0]] += 1;
  }
  return counts;
}

interface CatalogueProvider {
  id?: unknown;
  address?: { postal?: unknown } | null;
  location?: { lat?: unknown } | null;
}

export async function main(argv: string[], _env: NodeJS.ProcessEnv, root: string): Promise<number> {
  const dirIndex = argv.indexOf("--dir");
  const dir = dirIndex >= 0 ? path.resolve(argv[dirIndex + 1] ?? "") : path.join(root, "data", "catalogue");
  const output = path.join(dir, OUTPUT_NAME);
  let catalogue: { providers?: CatalogueProvider[] };
  try {
    catalogue = JSON.parse(readFileSync(path.join(dir, "providers.json"), "utf8"));
  } catch (error) {
    console.error(`Cannot read providers.json in ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const located: LocatedProvider[] = [];
  for (const provider of catalogue.providers ?? []) {
    if (typeof provider.id !== "string" || typeof provider.location?.lat !== "number") {
      console.error(`A provider has no id or no latitude: ${JSON.stringify(provider.id)}`);
      return 1;
    }
    located.push({ id: provider.id, postal: typeof provider.address?.postal === "string" ? provider.address.postal : null, lat: provider.location.lat });
  }

  if (existsSync(output) && !argv.includes("--force")) {
    const existing = JSON.parse(readFileSync(output, "utf8")) as { reviewed?: unknown };
    if (existing.reviewed === true) {
      console.error(`${OUTPUT_NAME} has been reviewed by the Hub: not overwritten (--force replaces it and sets "reviewed" back to false).`);
      return 1;
    }
  }

  const providers = deriveNeighbourhoods(located);
  writeFileSync(output, fileText(providers));
  const counts = countsOf(providers);
  console.log(`${OUTPUT_NAME}: ${counts.providers} providers. Thorncliffe Park only: ${counts.TP}. Flemingdon Park only: ${counts.FP}. Both: ${counts.both}. Neither: ${counts.none}.`);
  return 0;
}
