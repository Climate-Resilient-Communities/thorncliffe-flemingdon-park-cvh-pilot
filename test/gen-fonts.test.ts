import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FONTS, OUTPUT, generate } from "../scripts/gen-fonts.mjs";
import { LAUNCH_LANGUAGES } from "../src/i18n/languages";

const ROOT = path.join(__dirname, "..");
const css = readFileSync(path.join(ROOT, OUTPUT), "utf8");
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
