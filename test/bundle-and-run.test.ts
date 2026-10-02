// scripts/lib/bundleAndRun.mjs: bundles a TypeScript script into a cache file named by its content,
// so worktrees and runs that bundle different code never overwrite each other's file.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bundleToCache } from "../scripts/lib/bundleAndRun.mjs";

const ROOT = path.join(__dirname, "..");
const dirs: string[] = [];
const caches = new Set<string>();

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  for (const cache of caches) rmSync(path.dirname(cache), { recursive: true, force: true });
});

function entry(source: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "cvh-bundle-"));
  dirs.push(dir);
  const file = path.join(dir, "main.ts");
  writeFileSync(file, source);
  return file;
}

async function bundle(source: string, file = entry(source)): Promise<string> {
  const outfile: string = await bundleToCache(file, "bundle-test");
  caches.add(outfile);
  return outfile;
}

describe("bundleToCache", () => {
  it("writes the bundle under node_modules/.cache/cvh-<name>/, named by a hash of its content", async () => {
    const outfile = await bundle("export const main = (): number => 7;\n");
    expect(path.dirname(outfile)).toBe(path.join(ROOT, "node_modules", ".cache", "cvh-bundle-test"));
    expect(path.basename(outfile)).toMatch(/^[0-9a-f]{16}\.mjs$/);
    expect(readFileSync(outfile, "utf8")).toContain("7");
  });

  it("gives different code different files, so concurrent runs cannot clobber each other, and the same code the same file", async () => {
    const file = entry("export const main = (): number => 1;\n");
    const one = await bundle("", file);
    const two = await bundle("export const main = (): number => 2;\n");
    const again = await bundle("", file);
    expect(one).not.toBe(two);
    expect(again).toBe(one);
    expect(readFileSync(one, "utf8")).toContain("1");
    expect(readFileSync(two, "utf8")).toContain("2"); // still there after the other was written
  });
});
