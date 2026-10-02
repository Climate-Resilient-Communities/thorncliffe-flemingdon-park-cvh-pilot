// Reads the files of the buildings seed (S01.13): the City register's GeoJSON and the optional merge list.
import { existsSync, readFileSync } from "node:fs";
import { parseMergeFile, type MergeEntry, type PlanProblem, type RegisterFeature } from "../domain/register";

/** The register's features. Throws, naming the file, when it is not a GeoJSON FeatureCollection. */
export function readRegisterFile(file: string): RegisterFeature[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const collection = parsed as { type?: unknown; features?: unknown } | null;
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error(`${file} is not a GeoJSON FeatureCollection`);
  }
  return collection.features;
}

/** The merge list; a file that is not there is an empty list (merging is optional). */
export function readMergeFile(file: string): { entries: MergeEntry[]; failures: PlanProblem[] } {
  return existsSync(file) ? parseMergeFile(readFileSync(file, "utf8")) : { entries: [], failures: [] };
}
