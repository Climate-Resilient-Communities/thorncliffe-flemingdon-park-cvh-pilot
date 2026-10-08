import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..");

// An import names a module without its extension, so PauseBanner.tsx and pauseBanner.ts are both "./pauseBanner" to
// a case-insensitive file system (macOS's, Windows'): tsc and vitest then take one for the other there, while Linux CI
// passes. Test files and declaration files keep their suffix in the stem (pauseBanner.test.tsx is "pauseBanner.test").
const MODULE_EXTENSION = /\.(?:d\.)?(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

/**
 * Groups of paths that are one path, or one module, on a case-insensitive file system but differ in case: whole file
 * paths, every folder above them, and each source file's path without its extension.
 */
function caseClashes(files: string[]): string[][] {
  const names = new Set<string>();
  for (const file of files) {
    names.add(file);
    const parts = file.split("/");
    for (let depth = 1; depth < parts.length; depth++) names.add(`${parts.slice(0, depth).join("/")}/`);
    if (MODULE_EXTENSION.test(file)) names.add(file.replace(MODULE_EXTENSION, ""));
  }
  const byFolded = new Map<string, Set<string>>();
  for (const name of names) {
    const folded = name.toLowerCase();
    byFolded.set(folded, (byFolded.get(folded) ?? new Set()).add(name));
  }
  return [...byFolded.values()].filter((group) => group.size > 1).map((group) => [...group].sort());
}

describe("file names that differ only in case", () => {
  it("are found: a component and its module, two files, two folders", () => {
    expect(caseClashes(["src/app/staff/PauseBanner.tsx", "src/app/staff/pauseBanner.ts", "src/app/staff/pauseBanner.test.tsx"])).toEqual([
      ["src/app/staff/PauseBanner", "src/app/staff/pauseBanner"],
    ]);
    expect(caseClashes(["docs/Readme.md", "docs/README.md"])).toEqual([["docs/README.md", "docs/Readme.md"]]);
    expect(caseClashes(["src/ui/a.ts", "src/UI/b.ts"])).toEqual([["src/UI/", "src/ui/"]]);
    expect(caseClashes(["src/app/staff/PauseBanner.tsx", "src/app/staff/pauseBannerModel.ts", "src/app/staff/pauseBanner.test.tsx"])).toEqual([]);
  });

  it("do not exist among the repository's files, tracked or about to be", () => {
    const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
    expect(listed.status, listed.stderr).toBe(0);
    const files = listed.stdout.split("\0").filter(Boolean);
    expect(files.length).toBeGreaterThan(100);

    expect(caseClashes(files), "rename one of each group (a non-component module takes a Model suffix, as healthBannerModel.ts does)").toEqual([]);
  });
});
