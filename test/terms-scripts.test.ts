// The offline pipeline for the terms (S07.01): the same scripts as the guides (S02.09) translate, review and
// mark the terms, and the app's publish rules accept exactly what they record.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourceHash } from "@/modules/directory/adapters/hash";
import { readTermsCatalogue } from "@/modules/subscriptions/adapters/termsFiles";
import { planTerms, termsTexts, type TermsSource } from "@/modules/subscriptions/domain/terms";

const ROOT = path.join(__dirname, "..");
const STUB = path.join(ROOT, "test", "helpers", "stub_translate.py");
const REVIEW = path.join(ROOT, "scripts", "review_translations.py");
const OPTIONS = { hash: sourceHash, today: "2026-12-01" };

let dir: string;
let log: string;

const run = (script: string, args: string[]) =>
  execFileSync("python3", [script, ...args], { cwd: ROOT, env: { ...process.env, CVH_CATALOGUE_DIR: dir, STUB_CALL_LOG: log }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const plan = () => planTerms(readTermsCatalogue(dir), OPTIONS);
const readTerms = () => JSON.parse(readFileSync(path.join(dir, "terms.json"), "utf8")) as TermsSource;
const editTerms = (change: (t: TermsSource) => void) => {
  const terms = readTerms();
  change(terms);
  writeFileSync(path.join(dir, "terms.json"), JSON.stringify(terms, null, 1));
};
const nameOwnerAndContact = () =>
  editTerms((t) => {
    t.owner = "Ana Reyes";
    t.privacyContact = "privacy@example.org";
  });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cvh-terms-"));
  log = path.join(dir, "calls.log");
  cpSync(path.join(ROOT, "data", "catalogue", "terms.json"), path.join(dir, "terms.json"));
  writeFileSync(path.join(dir, "guides.json"), JSON.stringify({ guides: [] }));
  writeFileSync(path.join(dir, "numbers.json"), JSON.stringify({ numbers: [] }));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the terms in the content pipeline", () => {
  it("translates every terms text with the guides' translator, keeping STOP, 0 and 16, and loads it once reviewed", () => {
    run(STUB, ["--content", "--langs", "es"]);

    const file = JSON.parse(readFileSync(path.join(dir, "translations", "content", "es.json"), "utf8"));
    const keys = Object.keys(termsTexts(readTerms()));
    expect(Object.keys(file.texts).filter((k) => k.startsWith("terms."))).toEqual([...keys].sort());
    expect(file.texts["terms.stop.0"].text).toContain("0"); // the stub keeps digits, as the real translator must

    // A machine translation is not loaded: still English with translation.unavailable.
    expect(plan().documents.es.title.unavailable).toBe(true);

    run(REVIEW, ["--content", "--mark-reviewed", "es", "--reviewer", "Wei Chen", "--reviewed-on", "2026-11-02"]);
    const reviewed = plan();
    // The stub's answer to "Reply STOP..." has no STOP, so that line stays in English; a line with nothing to keep loads.
    expect(reviewed.documents.es.title).toMatchObject({ lang: "es", unavailable: false });
    expect(reviewed.documents.es.sections.find((s) => s.id === "stop")!.lines[0].unavailable).toBe(true);
  });

  it("makes a translation stale as soon as the English changes", () => {
    run(STUB, ["--content", "--langs", "es"]);
    run(REVIEW, ["--content", "--mark-reviewed", "es", "--reviewer", "Wei Chen", "--reviewed-on", "2026-11-02"]);
    expect(plan().documents.es.title.unavailable).toBe(false);

    editTerms((t) => (t.title = "Terms and your privacy"));

    expect(plan().documents.es.title).toMatchObject({ unavailable: true, text: "Terms and your privacy" });
    expect(plan().report.unavailable.find((u) => u.lang === "es" && u.key === "terms.title")?.reason).toBe("stale");
  });

  it("records the owner's English review and counsel's review, and the app publishes exactly then", () => {
    // Nothing can be signed before the owner and the privacy contact are named.
    expect(() => run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-10-02"])).toThrow();
    expect(() => run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-10-02"])).toThrow();
    expect(plan().published).toBe(false);

    nameOwnerAndContact();
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-10-02"]);
    expect(readTerms().englishReview).toMatchObject({ reviewer: "Ana Reyes", date: "2026-10-02" });
    expect(plan().reasons).toEqual(["counsel review: no named reviewer", "counsel review: no valid date", "counsel review: covers version none, not 2026-10-02.1", "counsel review: records no source hash (the text it reviewed)"]);

    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-10-02"]);
    expect(readTerms().counselReview).toMatchObject({ reviewer: "Counsel Co.", date: "2026-10-02", version: "2026-10-02.1" });
    expect(plan().reasons).toEqual([]);
    expect(plan().published).toBe(true);
  });

  it("stops publishing when the text, the contact or the version changes after counsel's review, until it is recorded again", () => {
    nameOwnerAndContact();
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-10-02"]);
    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-10-02"]);
    expect(plan().published).toBe(true);

    editTerms((t) => (t.sections![5].lines![0] = "Hub staff check every alert before it goes out."));
    expect(plan().published).toBe(false);
    expect(plan().reasons).toContain("the English changed since the owner reviewed it");
    expect(plan().reasons).toContain("counsel review: the terms changed since counsel reviewed them, so a new review is needed");

    // The owner reviews the new English; counsel still has not seen it.
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-10-02"]);
    expect(plan().reasons.every((r) => r.startsWith("counsel review:"))).toBe(true);
    expect(plan().published).toBe(false);

    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-10-02"]);
    expect(plan().published).toBe(true);

    editTerms((t) => (t.privacyContact = "other@example.org"));
    expect(plan().published).toBe(false);
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-10-02"]);
    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-10-02"]);
    expect(plan().published).toBe(true);

    editTerms((t) => (t.consentVersion = "2026-10-09.1"));
    expect(plan().reasons).toEqual(["counsel review: covers version 2026-10-02.1, not 2026-10-09.1"]);
  });

  it("refuses a review by the wrong person, a placeholder, a future date or one before the last update", () => {
    nameOwnerAndContact();
    const english = (reviewer: string, on: string) => () =>
      run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", reviewer, "--reviewed-on", on]);
    const counsel = (reviewer: string, on: string) => () =>
      run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", reviewer, "--reviewed-on", on]);

    expect(english("Sam Lee", "2026-10-02")).toThrow();
    expect(english("PLACEHOLDER: later", "2026-10-02")).toThrow();
    expect(english("Ana Reyes", "2999-01-01")).toThrow();
    expect(english("Ana Reyes", "2026-10-01")).toThrow();
    expect(counsel("PLACEHOLDER: later", "2026-10-02")).toThrow();
    expect(counsel("Counsel Co.", "2999-01-01")).toThrow();
    expect(counsel("Counsel Co.", "2026-10-01")).toThrow();
    expect(readTerms().englishReview?.sourceHash).toBeUndefined();
    expect(readTerms().counselReview?.sourceHash).toBeNull();
  });
});
