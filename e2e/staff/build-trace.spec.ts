// The publish job hashes the committed catalogue (data/catalogue/) to record a release's source version, and the
// files are read at run time, not imported: Next only ships them with the function if next.config.ts says so
// (outputFileTracingIncludes). A function without them fails every publish with `catalogue_unreadable` — and only
// in a deployed build, never under `next dev`. So this checks the production build's trace of the publish
// function (the page whose server action publishes): every file of data/catalogue/ must be in it.
// It reads `.next` and needs no browser; it runs here because the staff end-to-end tests run after `npm run build`.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const ROOT = process.cwd();
const TRACE = path.join(ROOT, ".next", "server", "app", "staff", "directory", "page.js.nft.json");

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

test("the publish function's file trace includes every file of data/catalogue", () => {
  const trace = JSON.parse(readFileSync(TRACE, "utf8")) as { files: string[] };
  const traced = new Set(trace.files.map((file) => path.resolve(path.dirname(TRACE), file)));
  const committed = filesUnder(path.join(ROOT, "data", "catalogue"));

  expect(committed.length).toBeGreaterThan(0);
  expect(committed.filter((file) => !traced.has(file)).map((file) => path.relative(ROOT, file))).toEqual([]);
});
