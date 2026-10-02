// The offline pipeline for the guides and essential numbers (S02.09): translate (with a stubbed
// translator, no API), re-translate only changed text, zh-Hant from zh with OpenCC, review status.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRANSLATED_LANGS, contentTexts, sourceHash } from "@/modules/directory/domain/guideContent";

const ROOT = path.join(__dirname, "..");
const STUB = path.join(ROOT, "test", "helpers", "stub_translate.py");
const REVIEW = path.join(ROOT, "scripts", "review_translations.py");

const GUIDES = {
  guides: [
    {
      id: "power",
      owner: "Ana Reyes",
      lastUpdated: "2026-10-02",
      englishReview: { reviewer: "Ana Reyes", date: "2026-10-03" },
      readMins: 3,
      title: "Power outage",
      when911: "Call 911 if someone is in danger.",
      before: ["Keep a flashlight where you can find it in the dark.", "Write down important phone numbers on paper."],
      during: ["Use a flashlight, not candles."],
      after: ["Plug your electronics back in one at a time."],
    },
  ],
};
const NUMBERS = {
  owner: "Ana Reyes",
  lastUpdated: "2026-10-02",
  englishReview: { reviewer: "Ana Reyes", date: "2026-10-03" },
  numbers: [
    { id: "911", number: "911", emergency: true, label: "Emergency", when: "Call 911 if someone's life is in danger right now.", lastChecked: "2026-10-03" },
    { id: "hub", number: "(416) 421-8997", emergency: false, label: "Talk to someone at the Hub", lastChecked: "2026-10-03" },
  ],
};

let dir: string;
let log: string;

const run = (script: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync("python3", [script, ...args], {
    cwd: ROOT,
    env: { ...process.env, CVH_CATALOGUE_DIR: dir, STUB_CALL_LOG: log, ...env },
    encoding: "utf8",
  });
const translate = (args: string[], env?: Record<string, string>) => run(STUB, ["--content", ...args], env);
const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const readLang = (lang: string) => JSON.parse(readFileSync(path.join(dir, "translations", "content", `${lang}.json`), "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edit = (file: string, change: (data: Record<string, any>) => void) => {
  const p = path.join(dir, file);
  const data = JSON.parse(readFileSync(p, "utf8"));
  change(data);
  writeFileSync(p, JSON.stringify(data, null, 1));
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cvh-content-"));
  log = path.join(dir, "calls.log");
  writeFileSync(path.join(dir, "guides.json"), JSON.stringify(GUIDES));
  writeFileSync(path.join(dir, "numbers.json"), JSON.stringify(NUMBERS));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const KEYS = Object.keys(contentTexts({ guides: GUIDES.guides, numbers: NUMBERS }));

describe("content text keys and hashes", () => {
  it("are the same in the Python scripts and the seed, for the committed catalogue", () => {
    const script = [
      "import json, sys; sys.path.insert(0, 'scripts'); import content_catalogue as c",
      "print(json.dumps({k: [v, c.source_hash(v)] for k, v in c.content_texts().items()}))",
    ].join("\n");
    const python = JSON.parse(execFileSync("python3", ["-c", script], { cwd: ROOT, env: { ...process.env, CVH_CATALOGUE_DIR: path.join(ROOT, "data", "catalogue") }, encoding: "utf8" }));
    const guides = JSON.parse(readFileSync(path.join(ROOT, "data", "catalogue", "guides.json"), "utf8")).guides;
    const numbers = JSON.parse(readFileSync(path.join(ROOT, "data", "catalogue", "numbers.json"), "utf8"));
    const seed = contentTexts({ guides, numbers });

    expect(Object.keys(python)).toEqual(Object.keys(seed));
    for (const [key, english] of Object.entries(seed)) expect(python[key]).toEqual([english, sourceHash(english)]);
  });
});

describe("translate_catalogue.py --content", () => {
  it("writes a file per launch language with a null entry for every text, calling no API", () => {
    translate(["--init-files"]);

    expect(calls()).toEqual([]);
    for (const lang of TRANSLATED_LANGS) {
      const file = readLang(lang);
      expect(file.language).toBe(lang);
      expect(Object.keys(file.texts)).toEqual([...KEYS].sort());
      expect(Object.values(file.texts).every((v) => v === null)).toBe(true);
    }
  });

  it("translates every text with traceability fields, machine status and no reviewer", () => {
    translate(["--langs", "ur,es"]);

    const record = readLang("ur").texts["guide.power.when911"];
    expect(record).toMatchObject({
      source: "Call 911 if someone is in danger.",
      sourceHash: sourceHash("Call 911 if someone is in danger."),
      model: expect.any(String),
      status: "machine",
      reviewer: null,
      reviewedOn: null,
    });
    expect(record.text).toContain("911");
    expect(record.translatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(calls()).toHaveLength(KEYS.length * 2);
  });

  it("sends only new or changed text on a re-run", () => {
    translate(["--langs", "ur,es"]);
    const before = readLang("ur").texts;
    rmSync(log);

    translate(["--langs", "ur,es"]);
    expect(calls()).toEqual([]);

    edit("guides.json", (g) => (g.guides[0].during[0] = "Use a flashlight, never candles."));
    translate(["--langs", "ur,es"]);

    expect(calls()).toHaveLength(2); // the one changed text, in two languages
    expect(calls().every((c) => c.text === "Use a flashlight, never candles.")).toBe(true);
    const after = readLang("ur").texts;
    expect(after["guide.power.during.0"].sourceHash).toBe(sourceHash("Use a flashlight, never candles."));
    expect(after["guide.power.title"]).toEqual(before["guide.power.title"]);
  });

  it("drops a translation whose English changed when no API is available", () => {
    translate(["--langs", "ur"]);
    edit("numbers.json", (n) => (n.numbers[1].label = "Talk to the Hub"));

    translate(["--init-files"]);

    const texts = readLang("ur").texts;
    expect(texts["number.hub.label"]).toBeNull();
    expect(texts["number.911.label"]).not.toBeNull();
  });

  it("keeps a text null, with the attempts recorded, when the checks reject every answer", () => {
    translate(["--langs", "es"], { STUB_MODE: "english" });

    const file = readLang("es");
    expect(Object.values(file.texts).every((v) => v === null)).toBe(true);
    expect(Object.keys(file.failed)).toEqual([...KEYS].sort());
  });

  it("creates zh-Hant from zh with OpenCC, recording the source hash, version and configuration", () => {
    translate(["--langs", "zh,zh-Hant"]);

    const zh = readLang("zh").texts["guide.power.title"];
    const hant = readLang("zh-Hant").texts["guide.power.title"];
    const openccVersion = JSON.parse(readFileSync(path.join(ROOT, "node_modules", "opencc-js", "package.json"), "utf8")).version;

    expect(zh.text).toContain("软件");
    expect(hant.text).toContain("軟體");
    expect(hant).toMatchObject({
      model: "opencc",
      sourceHash: sourceHash("Power outage"),
      status: "machine",
      conversion: { from: "zh", fromTextHash: sourceHash(zh.text), openccVersion, config: expect.stringContaining("twp") },
    });
    expect(calls().every((c) => KEYS.length > 0 && typeof c.model === "string")).toBe(true);
    expect(calls()).toHaveLength(KEYS.length); // zh only: zh-Hant is never sent to a model
  });

  it("converts zh-Hant again only for a zh text that changed", () => {
    translate(["--langs", "zh,zh-Hant"]);
    const before = readLang("zh-Hant").texts;

    edit("guides.json", (g) => (g.guides[0].after[0] = "Plug your electronics in again, one by one."));
    translate(["--langs", "zh,zh-Hant"]);

    const after = readLang("zh-Hant").texts;
    expect(after["guide.power.after.0"].sourceHash).toBe(sourceHash("Plug your electronics in again, one by one."));
    expect(after["guide.power.title"]).toEqual(before["guide.power.title"]);
  });
});

describe("review status (review_translations.py --content)", () => {
  it("marks current machine translations reviewed with reviewer and date, and zh-Hant follows zh", () => {
    translate(["--langs", "zh,zh-Hant"]);

    run(REVIEW, ["--content", "--mark-reviewed", "zh", "--reviewer", "Wei Chen", "--reviewed-on", "2026-11-02"]);

    const zh = readLang("zh").texts["guide.power.when911"];
    const hant = readLang("zh-Hant").texts["guide.power.when911"];
    expect(zh).toMatchObject({ status: "reviewed", reviewer: "Wei Chen", reviewedOn: "2026-11-02" });
    expect(hant).toMatchObject({ status: "reviewed", reviewer: "Wei Chen", reviewedOn: "2026-11-02" });
  });

  it("refuses a placeholder reviewer and zh-Hant by hand", () => {
    translate(["--langs", "zh,zh-Hant"]);

    expect(() => run(REVIEW, ["--content", "--mark-reviewed", "zh", "--reviewer", "PLACEHOLDER: later", "--reviewed-on", "2026-11-02"])).toThrow();
    expect(() => run(REVIEW, ["--content", "--mark-reviewed", "zh-Hant", "--reviewer", "Wei Chen", "--reviewed-on", "2026-11-02"])).toThrow();
    expect(readLang("zh").texts["guide.power.title"].status).toBe("machine");
  });

  it("reports stale translations without changing any file", () => {
    translate(["--langs", "ur"]);
    edit("guides.json", (g) => (g.guides[0].title = "Power cut"));

    const out = run(REVIEW, ["--content"]);

    expect(out).toContain("ur: 0 reviewed, 8 machine, 1 stale");
    expect(readLang("ur").texts["guide.power.title"].source).toBe("Power outage");
  });

  it("leaves the committed catalogue's content files untouched by a copy of itself", () => {
    // The committed files are the null skeleton: nothing translated, nothing reviewed.
    cpSync(path.join(ROOT, "data", "catalogue", "translations", "content"), path.join(dir, "translations", "content"), { recursive: true });
    cpSync(path.join(ROOT, "data", "catalogue", "guides.json"), path.join(dir, "guides.json"));
    cpSync(path.join(ROOT, "data", "catalogue", "numbers.json"), path.join(dir, "numbers.json"));

    const out = run(REVIEW, ["--content"]);

    expect(out).toContain("ur: 0 reviewed, 0 machine, 0 stale, 76 not translated");
  });
});
