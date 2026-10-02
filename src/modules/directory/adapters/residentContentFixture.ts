// Sample guides and essential numbers for the resident page tests and their screenshots (S02.10): a JSON file read
// instead of the database, named by CVH_FAKE_GUIDES_FILE, which the environment check allows only in local
// development. The file is `{ "guides": GuideRecord[], "numbers": NumberRecord[] }`, the rows as the seed stores them.
import { readFileSync } from "node:fs";
import type { ResidentContent } from "../application/residentContent";

export function readResidentContentFixtureFile(file: string): ResidentContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const content = parsed as Partial<ResidentContent> | null;
  if (!content || !Array.isArray(content.guides) || !Array.isArray(content.numbers)) {
    throw new Error(`${file} is not an object with a "guides" array and a "numbers" array`);
  }
  return { guides: content.guides, numbers: content.numbers };
}
