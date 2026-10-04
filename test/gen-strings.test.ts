import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
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

function leaves(
  messages: Messages,
  prefix = "",
  all: Record<string, string | string[]> = {},
): Record<string, string | string[]> {
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value === "string" || Array.isArray(value)) all[prefix + key] = value;
    else leaves(value, `${prefix}${key}.`, all);
  }
  return all;
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

// The prototype's string tables, loaded the way its pages load them.
function loadTables(source: string): Record<string, unknown> {
  const window: Record<string, unknown> = {};
  const context = vm.createContext({ window });
  const run = (file: string) => vm.runInContext(readFileSync(path.join(source, file), "utf8"), context);
  const files = readdirSync(source).filter((file) => /^strings\..+\.js$/.test(file));
  for (const file of ["strings.en.js", "strings.en.screens.js"]) run(file);
  for (const file of files) if (!file.startsWith("strings.en")) run(file);
  return (window as { CVH_STRINGS: Record<string, unknown> }).CVH_STRINGS;
}

const hasWords = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(hasWords)
    : typeof value === "string" && /\p{L}/u.test(value.replace(/\{\w+\}/g, ""));

// Dotted keys each language lacks, worked out from the sources alone: a key is lacking when
// the language has no value for it (a list with no entries counts as none; "" is a value)
// and the English value has words.
function expectedMissingKeys(): Record<string, string[]> {
  const tables = loadTables(PROTOTYPE) as Record<string, Record<string, unknown>>;
  const walk = (en: Record<string, unknown>, tr: unknown, prefix: string, out: string[]) => {
    for (const [key, value] of Object.entries(en)) {
      const own = tr && typeof tr === "object" && !Array.isArray(tr) ? (tr as Record<string, unknown>)[key] : undefined;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        walk(value as Record<string, unknown>, own, `${prefix}${key}.`, out);
      } else {
        const has = own !== undefined && own !== null && !(Array.isArray(own) && own.length === 0);
        if (!has && hasWords(value)) out.push(prefix + key);
      }
    }
    return out;
  };
  return Object.fromEntries(LANGUAGES.map((code) => [code, walk(tables.en, tables[code], "", [])]));
}

function expectedMissing(): Record<string, number> {
  const keys = expectedMissingKeys();
  return { en: 0, ...Object.fromEntries(LANGUAGES.map((code) => [code, keys[code].length])) };
}

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
        en: `{ a: { b: 'Hello {name}', c: 'Plain' }, list: ['One', '12%', ''], ...${complete} }`,
        fr: `{ a: { c: 'Simple' }, list: [], ...${complete} }`,
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
    const enValue = (key: string) => en[key];

    for (const code of LANGUAGES) {
      const catalog = leaves(read(COMMITTED, code));
      expect(Object.keys(catalog)).toEqual(Object.keys(en));
      for (const [key, value] of Object.entries(catalog)) {
        if (typeof value !== "string") continue;
        if (value === "") expect(enValue(key) === "" || (code === "zh" && key === "time.join")).toBe(true);
        expect(value, `${code} ${key}`).not.toBe(key);
      }
    }
    const fr = leaves(read(COMMITTED, "fr"));
    // Staff screens stay in English (staff write in English), so a staff key shows English behind the marker.
    expect(fr["staff.bootstrap.incomplete"]).toBe(`${MARKER}Finish setting up two Admins first`);
    expect(fr["R07.notYetKnown"]).toBe("Pas encore connu");
    expect(fr["x04.label"]).toBe("Traduit automatiquement");
  });

  it.each(ALL)("all parse as message format in %s", (code) => {
    const t = translator(COMMITTED, code);
    for (const [key, value] of Object.entries(leaves(read(COMMITTED, code)))) {
      if (typeof value !== "string") continue;
      const values = Object.fromEntries([...value.matchAll(/\{(\w+)\}/g)].map(([, name]) => [name, "x"]));
      expect(() => t(key, values), `${code} ${key}`).not.toThrow();
    }
  });
});

describe("string report and checks", () => {
  it("count exactly the keys each language lacks, computed from the prototype sources", () => {
    const { report } = generateCatalogs();
    const counts = Object.fromEntries(report.map(({ code, missing }) => [code, missing]));
    const expected = expectedMissing();

    expect(counts.en).toBe(0);
    expect(counts).toEqual(expected);
    for (const code of LANGUAGES) {
      const marked = Object.values(leaves(read(COMMITTED, code))).filter((value) =>
        JSON.stringify(value).includes(`"${MARKER}`),
      );
      expect(marked.length, code).toBe(counts[code]);
    }
  });

  it("keep a deliberately empty translation and count it present", () => {
    const zh = leaves(read(COMMITTED, "zh"));
    const { report } = generateCatalogs();
    const missing = expectedMissingKeys().zh;

    expect(zh["time.join"]).toBe("");
    expect(missing).not.toContain("time.join");
    expect(report.find(({ code }) => code === "zh")?.missing).toBe(missing.length);
  });

  it("copy an English value with no words unmarked and do not count it missing", () => {
    const fr = leaves(read(COMMITTED, "fr"));

    expect(fr["R03.myNeighbourhood"]).toBe("{nbhd}");
    expect(expectedMissingKeys().fr).not.toContain("R03.myNeighbourhood");

    const dir = writePrototype(
      "deliberate",
      { en: `{ p: '{nbhd}', e: '', n: '12%', w: 'Words', ...${complete} }`, fr: complete },
      ["fr"],
    );
    const out = path.join(work, "deliberate-out");
    const result = generate("--source", dir, "--out", out);
    const catalog = read(out, "fr");

    expect(result.stdout).toContain("| fr | 1 | none |");
    expect([catalog.p, catalog.e, catalog.n, catalog.w]).toEqual(["{nbhd}", "", "12%", `${MARKER}Words`]);
  });

  it("keep a present-but-empty translation of an English text as empty", () => {
    const dir = writePrototype("empty-translation", { en: `{ j: 'and', ...${complete} }`, fr: `{ j: '', ...${complete} }` }, ["fr"]);
    const out = path.join(work, "empty-translation-out");
    const result = generate("--source", dir, "--out", out);

    expect(result.stdout).toContain("| fr | 0 | none |");
    expect(read(out, "fr").j).toBe("");
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
  });

  it("require exactly the 911 block, the machine-translation label and Not known", () => {
    expect([...REQUIRED_KEYS]).toEqual([
      "x01.text",
      "x01.call",
      "x01.short",
      "x01.sms",
      "x01.print",
      "x04.label",
      "x09.unknown",
      "status.unknown",
    ]);
  });

  it.each(REQUIRED_KEYS)("fail when %s is removed from a language of the real prototype", (key) => {
    const copy = path.join(work, `remove-${key}`);
    cpSync(PROTOTYPE, copy, { recursive: true });
    const file = path.join(copy, "strings.fr.js");
    const [group, leaf] = key.split(".");
    const before = readFileSync(file, "utf8");
    const table = loadTables(copy).fr as Record<string, Record<string, unknown>>;
    expect(typeof table[group][leaf]).toBe("string");
    // Append a statement that deletes the key after the table is defined.
    writeFileSync(file, `${before}\ndelete window.CVH_STRINGS.fr.${group}.${leaf};\n`);
    const result = generate("--source", copy, "--out", path.join(work, `remove-out-${key}`));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`"fr" is missing required keys: ${key}`);
  });

  it.each(REQUIRED_KEYS)("fail naming %s when English lacks it", (key) => {
    const copy = path.join(work, `rename-${key}`);
    cpSync(PROTOTYPE, copy, { recursive: true });
    const file = path.join(copy, "strings.en.js");
    const [group, leaf] = key.split(".");
    writeFileSync(
      file,
      `${readFileSync(file, "utf8")}\nwindow.CVH_STRINGS.en.${group}.${leaf}Renamed = window.CVH_STRINGS.en.${group}.${leaf};\ndelete window.CVH_STRINGS.en.${group}.${leaf};\n`,
    );
    const result = generate("--source", copy, "--out", path.join(work, `rename-out-${key}`));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(key);
    expect(result.stderr).toMatch(/required/i);
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

  it.each([
    ["a space", "' '"],
    ["an empty string", "''"],
    ["a tab and newline", "'\\t\\n'"],
    ["a number", "5"],
    ["a list", "['C']"],
  ])("fail when a language's required x01.call is %s, which counts as missing", (name, value) => {
    const fr = `{ x01: { text: 'T', call: ${value}, short: 'S', sms: 'M', print: 'P' }, ${REQUIRED.label}, ${REQUIRED.unknown} }`;
    const dir = writePrototype(`blank-${name}`, { en: complete, fr }, ["fr"]);
    const out = path.join(work, `blank-out-${name}`);
    const result = generate("--source", dir, "--out", out);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"fr" is missing required keys: x01.call');
    expect(readFileSync(path.join(out, "fr.json"), "utf8")).toContain("[EN]");
  });

  it("keep a deliberately empty translation of a key that is not required", () => {
    const en = `{ other: 'O', ...${complete} }`;
    const fr = `{ other: '', ...${complete} }`;
    const dir = writePrototype("blank-optional", { en, fr }, ["fr"]);
    const result = generate("--source", dir, "--out", path.join(work, "blank-optional-out"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("| fr | 0 | none |");
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

  it("fail generation, naming the key, when a required key is not a non-empty English string", () => {
    const copy = path.join(work, "renamed");
    cpSync(PROTOTYPE, copy, { recursive: true });
    const file = path.join(copy, "strings.en.js");
    writeFileSync(file, readFileSync(file, "utf8").replace("x04: { label:", "x04: { labelRenamed:"));
    const result = generate("--source", copy, "--out", path.join(work, "renamed-out"));

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/required key "x04\.label"/i);
  });

  it("runs the strings check even when an earlier CI step failed", () => {
    const workflow = readFileSync(path.join(ROOT, ".github", "workflows", "checks.yml"), "utf8");
    const staticJob = workflow.slice(workflow.indexOf("  static:"), workflow.indexOf("  database:"));

    expect(staticJob).toMatch(/- if: \$\{\{ !cancelled\(\) \}\}\n\s+run: npm run check:strings/);
  });

  it("is a step of the Static job of the checks in CI", () => {
    const workflow = readFileSync(path.join(ROOT, ".github", "workflows", "checks.yml"), "utf8");
    const staticJob = workflow.slice(workflow.indexOf("  static:"), workflow.indexOf("  database:"));

    expect(staticJob).toContain("run: npm run check:strings");
  });
});
