import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MARKER, REQUIRED_KEYS, generateCatalogs } from "../scripts/gen-strings.cjs";

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "gen-strings.cjs");
const PROTOTYPE = path.join(ROOT, "design", "prototype", "cvh");
const COMMITTED = path.join(ROOT, "src", "i18n", "messages");

type Messages = { [key: string]: string | string[] | Messages };

const LANGUAGES = ["ur", "ps", "tl", "prs", "gu", "ta", "el", "sk", "bn", "hi", "pa", "zh", "es", "fr"];
const ALL = ["en", ...LANGUAGES];

function leaves(messages: Messages, prefix = ""): Record<string, string | string[]> {
  return Object.entries(messages).reduce<Record<string, string | string[]>>((all, [key, value]) => {
    if (typeof value === "string" || Array.isArray(value)) return { ...all, [prefix + key]: value };
    return { ...all, ...leaves(value, `${prefix}${key}.`) };
  }, {});
}

const read = (dir: string, code: string): Messages =>
  JSON.parse(readFileSync(path.join(dir, `${code}.json`), "utf8"));

function translator(dir: string, locale: string) {
  const t = createTranslator({
    locale,
    messages: read(dir, locale),
    onError: (error) => {
      throw error;
    },
  });
  return t as unknown as (key: string, values?: Record<string, string>) => string;
}

function generate(...args: string[]) {
  return spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
  });
}

let work: string;

// A small prototype in a temp directory: data.js lists `codes`, and `tables` maps a
// language code to the body of its string table.
function writePrototype(name: string, tables: Record<string, string>, codes: string[]) {
  const dir = path.join(work, name);
  mkdirSync(dir);
  const languages = codes.map((code) => ({ code, dir: "ltr" }));
  writeFileSync(path.join(dir, "data.js"), `window.CVH_DATA = { languages: ${JSON.stringify(languages)} };`);
  for (const [code, body] of Object.entries(tables)) {
    const text = `window.CVH_STRINGS = window.CVH_STRINGS || {}; window.CVH_STRINGS.${code} = ${body};`;
    writeFileSync(path.join(dir, `strings.${code}.js`), text);
  }
  return dir;
}

const REQUIRED = {
  call: "x01: { text: 'T', call: 'C', short: 'S', sms: 'M', print: 'P' }",
  label: "x04: { label: 'L' }",
  unknown: "x09: { unknown: 'U' }, status: { unknown: 'U' }",
};
const complete = `{ ${Object.values(REQUIRED).join(", ")} }`;

beforeAll(() => {
  work = mkdtempSync(path.join(tmpdir(), "gen-strings-"));
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("string catalogs", () => {
  it("are written one per launch language in src/i18n", () => {
    const { report } = generateCatalogs();
    const languages = readFileSync(path.join(PROTOTYPE, "data.js"), "utf8").match(/"code": "[\w-]+"/g);

    expect(languages).toHaveLength(15);
    expect(report.map(({ code }) => code).sort()).toEqual([...ALL].sort());
    expect(readdirSync(COMMITTED).sort()).toEqual(ALL.map((code) => `${code}.json`).sort());
  });

  it("are identical when generated twice", () => {
    const out = path.join(work, "twice");
    const files = () => readdirSync(out).map((name) => readFileSync(path.join(out, name), "utf8"));

    expect(generate("--out", out).status).toBe(0);
    const first = files();
    expect(generate("--out", out).status).toBe(0);

    expect(first).toHaveLength(15);
    expect(files()).toEqual(first);
  });

  it("include the English screen strings", () => {
    const { R07 } = read(COMMITTED, "en") as { R07: Messages };

    expect(R07.notYetKnown).toBe("Not known yet");
  });

  it("show a missing key as the English text with the [EN] marker, never empty or a raw key", () => {
    const dir = writePrototype(
      "missing",
      {
        en: "{ a: { b: 'Hello {name}', c: 'Plain' }, list: ['One', '12%', ''] }",
        fr: "{ a: { b: '', c: 'Simple' }, list: [] }",
      },
      ["fr"],
    );
    const out = path.join(work, "missing-out");
    generate("--source", dir, "--out", out);
    const fr = translator(out, "fr");

    expect(fr("a.b", { name: "Luis" })).toBe("[EN] Hello Luis");
    expect(fr("a.c")).toBe("Simple");
    expect(read(out, "fr").list).toEqual(["[EN] One", "12%", ""]);
    expect(translator(out, "en")("a.b", { name: "Luis" })).toBe("Hello Luis");
  });

  it("have every key in every language, each either translated or English behind the marker", () => {
    const en = leaves(read(COMMITTED, "en"));

    for (const code of LANGUAGES) {
      const catalog = leaves(read(COMMITTED, code));
      expect(Object.keys(catalog)).toEqual(Object.keys(en));
      for (const [key, value] of Object.entries(catalog)) {
        if (typeof value !== "string") continue;
        expect(value, `${code} ${key}`).not.toBe("");
        expect(value, `${code} ${key}`).not.toBe(key);
      }
    }
    const fr = leaves(read(COMMITTED, "fr"));
    expect(fr["R07.notYetKnown"]).toBe(`${MARKER}Not known yet`);
    expect(fr["x04.label"]).toBe("Traduit automatiquement");
  });

  it("all parse as message format", () => {
    for (const code of ALL) {
      const t = translator(COMMITTED, code);
      for (const [key, value] of Object.entries(leaves(read(COMMITTED, code)))) {
        if (typeof value !== "string") continue;
        const values = Object.fromEntries([...value.matchAll(/\{(\w+)\}/g)].map(([, name]) => [name, "x"]));
        expect(() => t(key, values), `${code} ${key}`).not.toThrow();
      }
    }
  });
});

describe("string report and checks", () => {
  it("count the keys each language lacks", () => {
    const { report } = generateCatalogs();
    const counts = Object.fromEntries(report.map(({ code, missing }) => [code, missing]));

    expect(counts.en).toBe(0);
    for (const code of LANGUAGES) {
      const marked = Object.values(leaves(read(COMMITTED, code))).filter(
        (value) => typeof value === "string" && value.startsWith(MARKER),
      );
      // Lists with no words are missing without being marked; there are few.
      expect(marked.length).toBeLessThanOrEqual(counts[code]);
      expect(marked.length).toBeGreaterThan(counts[code] - 20);
    }
  });

  it("print the per-language report", () => {
    const { stdout, status } = generate("--check");

    expect(status).toBe(0);
    expect(stdout).toContain("| Language | Keys missing (shown in English with [EN]) | Required keys missing |");
    for (const code of ALL) expect(stdout).toMatch(new RegExp(`\\| ${code} \\| \\d+ \\| none \\|`));
  });

  it("pass for the real prototype: every language has the 911 block, the label and Not known", () => {
    const { report } = generateCatalogs();

    expect(report.flatMap(({ requiredMissing }) => requiredMissing)).toEqual([]);
    expect(REQUIRED_KEYS).toEqual(
      expect.arrayContaining(["x01.call", "x01.short", "x04.label", "x09.unknown", "status.unknown"]),
    );
  });

  it.each([
    ["x01.call", `{ x01: { text: 'T', short: 'S', sms: 'M', print: 'P' }, ${REQUIRED.label}, ${REQUIRED.unknown} }`],
    ["x04.label", `{ ${REQUIRED.call}, ${REQUIRED.unknown} }`],
    ["x09.unknown", `{ ${REQUIRED.call}, ${REQUIRED.label}, status: { unknown: 'U' } }`],
    ["status.unknown", `{ ${REQUIRED.call}, ${REQUIRED.label}, x09: { unknown: 'U' } }`],
  ])("fail when a language lacks %s", (key, fr) => {
    const dir = writePrototype(`required-${key}`, { en: complete, fr }, ["fr"]);
    const result = generate("--source", dir, "--out", path.join(work, `required-out-${key}`));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`"fr" is missing required keys: ${key}`);
  });

  it("do not fail for a missing key outside the required set", () => {
    const dir = writePrototype("optional", { en: `{ other: 'O', ...${complete} }`, fr: complete }, ["fr"]);
    const result = generate("--source", dir, "--out", path.join(work, "optional-out"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("| fr | 1 | none |");
  });

  it("fail when a launch language has no string table", () => {
    const dir = writePrototype("no-table", { en: complete }, ["fr"]);
    const result = generate("--source", dir, "--out", path.join(work, "no-table-out"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No string table for language "fr"');
  });
});

describe("stale catalogs", () => {
  it("pass --check when the committed catalogs match a fresh generation", () => {
    expect(generate("--check").status).toBe(0);
  });

  it("fail --check when a catalog was edited by hand", () => {
    const copy = path.join(work, "edited");
    cpSync(COMMITTED, copy, { recursive: true });
    const file = path.join(copy, "fr.json");
    writeFileSync(file, readFileSync(file, "utf8").replace("Traduit automatiquement", "Traduit à la main"));
    const result = generate("--check", "--out", copy);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("fr.json (differs)");
  });

  it("fail --check when a catalog is missing or added", () => {
    const copy = path.join(work, "shape");
    cpSync(COMMITTED, copy, { recursive: true });
    rmSync(path.join(copy, "ur.json"));
    writeFileSync(path.join(copy, "xx.json"), "{}\n");
    const result = generate("--check", "--out", copy);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ur.json (missing)");
    expect(result.stderr).toContain("xx.json (not generated)");
  });

  it("fail --check when the prototype strings change and the catalogs were not regenerated", () => {
    const changed = path.join(work, "changed");
    cpSync(PROTOTYPE, changed, { recursive: true });
    const file = path.join(changed, "strings.en.js");
    writeFileSync(file, readFileSync(file, "utf8").replace("unknown: 'Not known'", "unknown: 'Unknown'"));
    const result = generate("--check", "--source", changed);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("en.json (differs)");
  });

  it("is a step of the Checks job in CI", () => {
    const workflow = readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    const checks = workflow.slice(workflow.indexOf("  checks:"), workflow.indexOf("  preview:"));

    expect(checks).toContain("run: npm run check:strings");
  });
});
