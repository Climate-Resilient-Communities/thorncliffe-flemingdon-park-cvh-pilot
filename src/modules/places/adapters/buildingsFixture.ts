// Sample buildings for the resident page tests and their screenshots (S02.08): a JSON file read instead of the
// database, named by CVH_FAKE_BUILDINGS_FILE, which the environment check allows only in local development.
// The file is an array of buildings as readPublicBuilding returns them, with the dates written as ISO strings.
import { readFileSync } from "node:fs";
import type { PublicBuilding } from "../application/publicBuilding";

type Raw = Omit<PublicBuilding, "factsUpdatedAt" | "contact"> & {
  factsUpdatedAt: string;
  contact: { role: string; phone: string; updatedAt: string } | null;
};

/** The sample buildings in the file, by rsn. Throws, naming the file, when it is not an array of buildings. */
export function readBuildingsFixtureFile(file: string): Map<string, PublicBuilding> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${file} is not an array of buildings`);
  return new Map(
    (parsed as Raw[]).map((raw) => [
      raw.rsn,
      {
        ...raw,
        factsUpdatedAt: new Date(raw.factsUpdatedAt),
        contact: raw.contact ? { ...raw.contact, owner: "hub" as const, updatedAt: new Date(raw.contact.updatedAt) } : null,
      },
    ]),
  );
}
