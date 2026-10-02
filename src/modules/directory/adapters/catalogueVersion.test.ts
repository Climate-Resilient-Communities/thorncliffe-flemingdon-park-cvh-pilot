import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { catalogueHash, catalogueVersion, gitCommitOf } from "./catalogueVersion";

const dirs: string[] = [];
function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cvh-catalogue-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the catalogue's source version", () => {
  it("is the sha256 of every file under data/catalogue, whatever order the folder lists them in", async () => {
    const a = folder({ "providers.json": "{}", "translations/ur.json": "[1]", "review/x.json": "x" });
    const b = folder({ "review/x.json": "x", "translations/ur.json": "[1]", "providers.json": "{}" });

    expect(await catalogueHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(await catalogueHash(a)).toBe(await catalogueHash(b));
  });

  it("changes when a file changes, is added, is removed or is renamed", async () => {
    const base = await catalogueHash(folder({ "providers.json": "{}", "terms.json": "t" }));

    expect(await catalogueHash(folder({ "providers.json": "{ }", "terms.json": "t" }))).not.toBe(base);
    expect(await catalogueHash(folder({ "providers.json": "{}", "terms.json": "t", "numbers.json": "n" }))).not.toBe(base);
    expect(await catalogueHash(folder({ "providers.json": "{}" }))).not.toBe(base);
    expect(await catalogueHash(folder({ "providers.json": "{}", "terms2.json": "t" }))).not.toBe(base);
    const moved = folder({ "providers.json": "{}", "a/terms.json": "t" });
    const flat = folder({ "providers.json": "{}", "terms.json": "t" });
    expect(await catalogueHash(moved)).not.toBe(await catalogueHash(flat));
  });

  it("does not run two files together into one: the boundary between file name and content counts", async () => {
    expect(await catalogueHash(folder({ "a": "bc" }))).not.toBe(await catalogueHash(folder({ "ab": "c" })));
  });

  it("refuses an empty folder", async () => {
    await expect(catalogueHash(folder({}))).rejects.toThrow(/holds no files/);
  });

  it("names the commit of a CI build and none for a local one", () => {
    expect(gitCommitOf("3F2C1AB9d")).toBe("3f2c1ab9d");
    expect(gitCommitOf("a".repeat(40))).toBe("a".repeat(40));
    for (const local of [undefined, "", "dev", "not-a-hash", "abc", "g".repeat(40)]) expect(gitCommitOf(local), String(local)).toBeNull();
  });

  it("gives both together", async () => {
    const dir = folder({ "providers.json": "{}" });

    expect(await catalogueVersion(dir, "abcdef1")).toEqual({ hash: await catalogueHash(dir), gitCommit: "abcdef1" });
    expect((await catalogueVersion(dir, "dev")).gitCommit).toBeNull();
  });

  it("hashes the repository's own committed catalogue", async () => {
    expect(await catalogueHash(path.join(__dirname, "..", "..", "..", "..", "data", "catalogue"))).toMatch(/^[0-9a-f]{64}$/);
  });
});
