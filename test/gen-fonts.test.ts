import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FONTS, OUTPUT, STAFF_FONTS, STAFF_OUTPUT, generate, generateStaff } from "../scripts/gen-fonts.mjs";
import { LAUNCH_LANGUAGES } from "../src/i18n/languages";

const ROOT = path.join(__dirname, "..");
const css = readFileSync(path.join(ROOT, OUTPUT), "utf8");
const staffCss = readFileSync(path.join(ROOT, STAFF_OUTPUT), "utf8");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };

describe("self-hosted fonts (AD-16)", () => {
  it("fonts.generated.css is what the pinned @fontsource-variable packages give (run npm run gen:fonts)", () => {
    expect(css).toBe(generate(ROOT));
  });

  it("pins every font package to an exact version", () => {
    for (const { pkg: name } of FONTS) {
      expect(pkg.dependencies[`@fontsource-variable/${name}`], name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("declares a face for Public Sans and for the script of every launch language, with unicode-range slices", () => {
    const families = new Set([...css.matchAll(/font-family: '([^']+)'/g)].map(([, family]) => family));

    expect(families.has("Public Sans")).toBe(true);
    for (const { font } of LAUNCH_LANGUAGES) {
      if (font === "latin") continue;
      const wanted = { naskh: "Noto Naskh Arabic", gujarati: "Noto Sans Gujarati", tamil: "Noto Sans Tamil", greek: "Noto Sans", bengali: "Noto Sans Bengali", devanagari: "Noto Sans Devanagari", gurmukhi: "Noto Sans Gurmukhi", sc: "Noto Sans SC" }[font];
      expect(families.has(wanted!), font).toBe(true);
    }
    const faces = css.match(/@font-face/g)!.length;
    expect(css.match(/unicode-range:/g)!.length).toBe(faces);
  });

  it("loads every file from the app's own node_modules, never from a font service", () => {
    expect(css).not.toMatch(/https?:|\/\/fonts\.|googleapis|gstatic/);
    for (const [, url] of css.matchAll(/url\(([^)]+)\)/g)) expect(url).toMatch(/^\.\.\/\.\.\/\.\.\/node_modules\/@fontsource-variable\/[\w-]+\/files\/[\w[\]-]+\.woff2$/);
  });
});

describe("self-hosted fonts of the staff screens (S01.09)", () => {
  it("staff/fonts.generated.css is what the pinned package gives (run npm run gen:fonts)", () => {
    expect(staffCss).toBe(generateStaff(ROOT));
  });

  it("declares the Latin and Latin-extended faces of Public Sans and no other family or script", () => {
    expect(STAFF_FONTS.map(({ pkg: name }) => name)).toEqual(["public-sans"]);
    expect([...staffCss.matchAll(/font-family: '([^']+)'/g)].map(([, family]) => family)).toEqual(["Public Sans", "Public Sans"]);
    expect([...staffCss.matchAll(/^\/\* (\S+) \*\/$/gm)].map(([, slice]) => slice).sort()).toEqual(["public-sans-latin", "public-sans-latin-ext"]);
    expect(staffCss).not.toMatch(/noto/i);
  });

  it("loads every file from the app's own node_modules, with the same relative path as the resident file", () => {
    expect(staffCss).not.toMatch(/https?:|\/\/fonts\.|googleapis|gstatic/);
    for (const [, url] of staffCss.matchAll(/url\(([^)]+)\)/g)) {
      expect(url).toMatch(/^\.\.\/\.\.\/\.\.\/node_modules\/@fontsource-variable\/public-sans\/files\/public-sans-latin(-ext)?-wght-normal\.woff2$/);
      expect(existsSync(path.join(ROOT, "src", "app", "staff", url))).toBe(true);
    }
  });

  it("is checked by --check: a stale staff file fails it, naming that file only", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fonts-check-"));
    try {
      symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
      mkdirSync(path.join(dir, "scripts"));
      copyFileSync(path.join(ROOT, "scripts", "gen-fonts.mjs"), path.join(dir, "scripts", "gen-fonts.mjs"));
      for (const output of [OUTPUT, STAFF_OUTPUT]) {
        mkdirSync(path.dirname(path.join(dir, output)), { recursive: true });
        copyFileSync(path.join(ROOT, output), path.join(dir, output));
      }
      const run = (root = dir) => spawnSync(process.execPath, [path.join(root, "scripts", "gen-fonts.mjs"), "--check"], { encoding: "utf8" });

      expect(run().status).toBe(0);
      // Run through a symlink too (a linked checkout; macOS's temporary folder is one): the script still runs, and still finds a stale file.
      const link = `${dir}-link`;
      symlinkSync(dir, link);
      expect(run(link).stdout).toContain(`${STAFF_OUTPUT} is up to date.`);
      writeFileSync(path.join(dir, STAFF_OUTPUT), `${staffCss}/* stale */\n`);
      const stale = run();
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain(STAFF_OUTPUT);
      expect(stale.stderr).not.toContain(OUTPUT);
      expect(run(link).status).toBe(1);
    } finally {
      rmSync(`${dir}-link`, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
