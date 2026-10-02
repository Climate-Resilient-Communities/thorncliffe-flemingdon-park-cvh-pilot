// The offline pipeline for the guides and essential numbers (S02.09): translate (with a stubbed
// translator, no API), re-translate only changed text, zh-Hant from zh with OpenCC, review status.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourceHash } from "@/modules/directory/adapters/hash";
import {
  TRANSLATED_LANGS,
  contentTexts,
  englishReviewHash,
  guideKey,
  guideTexts,
  numberKey,
  numberTexts,
  planSeed,
  type GuideSource,
  type NumberSource,
} from "@/modules/directory/domain/guideContent";
import { termsReviewHash, termsTexts, type TermsSource } from "@/modules/subscriptions/domain/terms";

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
      "texts = c.content_texts()",
      "guides = c.read_json(c.GUIDES_PATH)['guides']; numbers = c.read_json(c.NUMBERS_PATH)['numbers']",
      "reviews = {g['id']: c.english_review_hash({'guide.%s.%s' % (g['id'], k): v for k, v in c.guide_texts(g).items()}) for g in guides}",
      "terms = c.read_json(c.TERMS_PATH); reviews['terms'] = c.english_review_hash(c.terms_review_texts(terms))",
      "reviews['numbers'] = c.english_review_hash({'number.%s.%s' % (n['id'], k): v for n in numbers for k, v in c.number_texts(n).items()})",
      "print(json.dumps({'texts': {k: [v, c.source_hash(v)] for k, v in texts.items()}, 'reviews': reviews}))",
    ].join("\n");
    const { texts: python, reviews } = JSON.parse(execFileSync("python3", ["-c", script], { cwd: ROOT, env: { ...process.env, CVH_CATALOGUE_DIR: path.join(ROOT, "data", "catalogue") }, encoding: "utf8" }));
    const guides = JSON.parse(readFileSync(path.join(ROOT, "data", "catalogue", "guides.json"), "utf8")).guides;
    const numbers = JSON.parse(readFileSync(path.join(ROOT, "data", "catalogue", "numbers.json"), "utf8"));
    const terms = JSON.parse(readFileSync(path.join(ROOT, "data", "catalogue", "terms.json"), "utf8")) as TermsSource;
    const seed = { ...contentTexts({ guides, numbers }), ...termsTexts(terms) };

    expect(Object.keys(python)).toEqual(Object.keys(seed));
    for (const [key, english] of Object.entries(seed)) expect(python[key]).toEqual([english, sourceHash(english)]);
    const ts: Record<string, string> = {
      terms: termsReviewHash(terms, sourceHash),
      numbers: englishReviewHash(
        Object.fromEntries(numbers.numbers.flatMap((n: NumberSource) => Object.entries(numberTexts(n)).map(([k, v]) => [numberKey(n.id, k), v]))),
        sourceHash,
      ),
    };
    for (const g of guides as GuideSource[]) {
      ts[g.id] = englishReviewHash(Object.fromEntries(Object.entries(guideTexts(g)).map(([k, v]) => [guideKey(g.id, k), v])), sourceHash);
    }
    expect(reviews).toEqual(ts);
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

  it("moves a translation to its new key when a line is inserted, translating only the new line", () => {
    translate(["--langs", "ur,es"]);
    run(REVIEW, ["--content", "--mark-reviewed", "ur", "--reviewer", "Wei Chen", "--reviewed-on", "2026-11-02"]);
    const before = readLang("ur").texts;
    rmSync(log);

    edit("guides.json", (g) => g.guides[0].before.unshift("Charge your phone before the storm."));
    translate(["--langs", "ur,es"]);

    expect(calls()).toHaveLength(2); // the one new line, once per language
    expect(calls().every((c) => c.text === "Charge your phone before the storm.")).toBe(true);
    const after = readLang("ur").texts;
    expect(after["guide.power.before.0"]).toMatchObject({ source: "Charge your phone before the storm.", status: "machine", reviewer: null });
    expect(after["guide.power.before.1"]).toEqual(before["guide.power.before.0"]);
    expect(after["guide.power.before.2"]).toEqual(before["guide.power.before.1"]);
    expect(after["guide.power.before.1"]).toMatchObject({ status: "reviewed", reviewer: "Wei Chen" });
    expect(after["guide.power.title"]).toEqual(before["guide.power.title"]);
  });

  it("moves the zh and zh-Hant translations with the line, with the review", () => {
    translate(["--langs", "zh,zh-Hant"]);
    run(REVIEW, ["--content", "--mark-reviewed", "zh", "--reviewer", "Wei Chen", "--reviewed-on", "2026-11-02"]);
    rmSync(log);

    edit("guides.json", (g) => g.guides[0].before.unshift("Charge your phone before the storm."));
    translate(["--langs", "zh,zh-Hant"]);

    expect(calls()).toHaveLength(1);
    const hant = readLang("zh-Hant").texts;
    expect(hant["guide.power.before.1"]).toMatchObject({ source: "Keep a flashlight where you can find it in the dark.", status: "reviewed", reviewer: "Wei Chen" });
    expect(hant["guide.power.before.0"]).toMatchObject({ status: "machine" });
  });

  it("tries the next model when the first one loses a number such as 911", () => {
    translate(["--langs", "es"], { STUB_DROP_DIGITS_FIRST: "1" });

    const texts = readLang("es").texts;
    expect(Object.values(texts).every((r) => r !== null)).toBe(true);
    const whenCalls = calls().filter((c) => c.text === "Call 911 if someone is in danger.");
    expect(whenCalls).toHaveLength(2);
    expect(whenCalls[0].model).not.toBe(whenCalls[1].model);
    expect(texts["guide.power.when911"].model).toBe(whenCalls[1].model);
    expect(texts["guide.power.when911"].text).toContain("911");
    expect(calls().filter((c) => c.text === "Power outage")).toHaveLength(1); // no number to lose: the first model is kept
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

  it("records the owner's English review with a hash of the English the seed checks", () => {
    run(REVIEW, ["--content", "--mark-english-reviewed", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-10-02"]);

    const guides = JSON.parse(readFileSync(path.join(dir, "guides.json"), "utf8"));
    const numbers = JSON.parse(readFileSync(path.join(dir, "numbers.json"), "utf8"));
    expect(guides.guides[0].englishReview).toMatchObject({ reviewer: "Ana Reyes", date: "2026-10-02" });
    const options = { hash: sourceHash, today: "2026-12-01" };
    const plan = planSeed({ guides: guides.guides, numbers, translations: {} }, options);
    expect(plan.report.guides).toEqual([{ id: "power", loaded: true, reasons: [] }]);
    expect(plan.report.numbers).toEqual({ loaded: true, reasons: [] });

    edit("guides.json", (g) => (g.guides[0].title = "Power cut"));
    const changed = JSON.parse(readFileSync(path.join(dir, "guides.json"), "utf8"));
    expect(planSeed({ guides: changed.guides, numbers, translations: {} }, options).report.guides[0].reasons).toEqual([
      "the English changed since the owner reviewed it",
    ]);
  });

  it("refuses an English review by someone other than the owner, a placeholder, a future date or one before the last update", () => {
    const sign = (reviewer: string, on: string) => () =>
      run(REVIEW, ["--content", "--mark-english-reviewed", "--reviewer", reviewer, "--reviewed-on", on]);

    expect(sign("Sam Lee", "2026-10-02")).toThrow();
    expect(sign("PLACEHOLDER: later", "2026-10-02")).toThrow();
    expect(sign("Ana Reyes", "2999-01-01")).toThrow();
    expect(sign("Ana Reyes", "2026-10-01")).toThrow();
    expect(JSON.parse(readFileSync(path.join(dir, "guides.json"), "utf8")).guides[0].englishReview.sourceHash).toBeUndefined();
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
