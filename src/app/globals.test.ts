import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compileCss } from "../../test/helpers/compile-css";
import { readSource } from "../../test/helpers/layout-css";

// This file is itself under src/ and a *.test.* file, so it is a live probe: the class names below must
// not reach the app's compiled stylesheet. check:spacing skips test files only because of that.
const PROBE_CLASSES = ["p-[13px]", "gap-[1rem]", "mt-[3px]"];

describe("src/app/globals.css", () => {
  it("does not scan test and spec files, so classes in them add no CSS", async () => {
    const css = await compileCss(path.join(__dirname, "globals.css"), { optimize: true });

    expect(PROBE_CLASSES.join(" ")).toContain("p-[13px]");
    for (const name of PROBE_CLASSES) expect(css, name).not.toContain(name.replace(/[[\]\\]/g, "\\$&"));
    expect(css).not.toMatch(/padding:\s*13px/);
  });

  it("excludes *.test.* and *.spec.* files from the sources", () => {
    const css = readSource("src/app/globals.css");

    expect(css).toMatch(/@source not "\.\.\/\*\*\/\*\.test\.\*";/);
    expect(css).toMatch(/@source not "\.\.\/\*\*\/\*\.spec\.\*";/);
  });

  describe("the same two exclusions in a scanned directory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sources-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("still generate the classes of other files (so the exclusion is what removes them)", async () => {
      mkdirSync(path.join(dir, "ui"), { recursive: true });
      writeFileSync(path.join(dir, "ui", "tile.tsx"), 'export const tile = "p-[13px]";\n');
      writeFileSync(path.join(dir, "ui", "tile.test.tsx"), 'export const probe = "gap-[1rem]";\n');
      writeFileSync(path.join(dir, "ui", "tile.spec.ts"), 'export const probe = "mt-[3px]";\n');
      writeFileSync(
        path.join(dir, "app.css"),
        `@import "${path.join(__dirname, "..", "ui", "tokens", "theme.css")}";\n@source "./";\n@source not "./**/*.test.*";\n@source not "./**/*.spec.*";\n`,
      );
      const css = await compileCss(path.join(dir, "app.css"));

      expect(css).toContain(".p-\\[13px\\]");
      expect(css).not.toContain("gap-\\[1rem\\]");
      expect(css).not.toContain("mt-\\[3px\\]");
    });
  });
});
