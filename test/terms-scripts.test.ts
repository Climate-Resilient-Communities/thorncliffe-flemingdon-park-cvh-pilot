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
/** Fills every TODO(owner) the committed draft leaves in the English (test values only). */
const settleTodos = (t: TermsSource) => {
  for (const section of t.sections ?? []) section.lines = (section.lines ?? []).map((line) => line?.replace(/TODO\(owner\)/g, "test region") ?? line);
};
const nameOwnerAndContact = () =>
  editTerms((t) => {
    settleTodos(t);
    t.owner = "Ana Reyes";
    t.privacyContact = "privacy@example.org";
    // Dated before today, whatever day the tests run (a review cannot be dated in the future).
    t.consentVersion = "2026-09-10.1";
    t.lastUpdated = "2026-09-10";
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
    expect(() => run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-10"])).toThrow();
    expect(() => run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-10"])).toThrow();
    expect(plan().published).toBe(false);

    nameOwnerAndContact();
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-10"]);
    expect(readTerms().englishReview).toMatchObject({ reviewer: "Ana Reyes", date: "2026-09-10" });
    expect(plan().reasons).toEqual(["counsel review: none is recorded"]);

    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-10"]);
    expect(readTerms().counselReview).toMatchObject({ reviewer: "Counsel Co.", date: "2026-09-10", version: "2026-09-10.1" });
    expect(plan().reasons).toEqual([]);
    expect(plan().published).toBe(true);
  });

  it("stops publishing when the text, the contact or the version changes after counsel's review, until it is recorded again", () => {
    nameOwnerAndContact();
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-10"]);
    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-10"]);
    expect(plan().published).toBe(true);

    // A changed text is a new version, dated the day it changed: the version, lastUpdated and both reviews all move.
    const revise = (version: string, on: string, change: (t: TermsSource) => void) =>
      editTerms((t) => {
        change(t);
        t.consentVersion = version;
        t.lastUpdated = on;
      });
    revise("2026-09-15.1", "2026-09-15", (t) => (t.sections![5].lines![0] = "Hub staff check every alert before it goes out."));
    expect(plan().published).toBe(false);
    expect(plan().reasons).toContain("the English review is dated before the last update");
    expect(plan().reasons).toContain("counsel review: the terms changed since counsel reviewed them, so a new review is needed");

    // The owner reviews the new English; counsel still has not seen it.
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-15"]);
    expect(plan().reasons.every((r) => r.startsWith("counsel review:"))).toBe(true);
    expect(plan().published).toBe(false);

    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-15"]);
    expect(plan().published).toBe(true);

    revise("2026-09-16.1", "2026-09-16", (t) => (t.privacyContact = "other@example.org"));
    expect(plan().published).toBe(false);
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-16"]);
    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-16"]);
    expect(plan().published).toBe(true);

    editTerms((t) => (t.consentVersion = "2026-09-20.1"));
    expect(plan().reasons).toEqual([
      "the last-updated date (2026-09-16) is before the date of consent_version 2026-09-20.1",
      "counsel review: covers version 2026-09-16.1, not 2026-09-20.1",
    ]);
  });

  it("refuses counsel's review of the draft: a draft consent version or a TODO(owner) left in the English", () => {
    // The committed draft: TODO(owner) in the owner, the contact and the English, and version 2026-10-draft-1.
    expect(() => run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "TODO(owner)", "--reviewed-on", "2026-09-10"])).toThrow(/--reviewer/);
    expect(plan().reasons).toEqual(
      expect.arrayContaining([
        "the owner is still a placeholder",
        "the privacy contact is still a placeholder",
        "the consent_version is not written YYYY-MM-DD.n",
        "the English text still holds a placeholder",
      ]),
    );

    editTerms((t) => {
      t.owner = "Ana Reyes";
      t.privacyContact = "privacy@example.org";
      t.lastUpdated = "2026-09-10";
    });
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-10"]);
    expect(() => run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-10"])).toThrow(/draft version/);

    editTerms((t) => (t.consentVersion = "2026-09-10.1"));
    expect(() => run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-10"])).toThrow(/TODO\(owner\)/);
    expect(readTerms().counselReview?.reviewer).toBeNull();
    expect(plan().published).toBe(false);
  });

  it("records every version counsel signs in publishedVersions", () => {
    nameOwnerAndContact();
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-10"]);
    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-10"]);

    expect(readTerms().publishedVersions).toEqual({ "2026-09-10.1": readTerms().counselReview!.sourceHash });
    // Re-recording counsel's review of the same text under the same version is harmless.
    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-11"]);
    expect(Object.keys(readTerms().publishedVersions!)).toEqual(["2026-09-10.1"]);
  });

  it("refuses to reuse a consent version for changed text, in the script and in the app, until the version is bumped", () => {
    nameOwnerAndContact();
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-10"]);
    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-10"]);
    const signed = readTerms().publishedVersions;
    expect(plan().published).toBe(true);

    // The reviewer's repro: change the age line, then run both reviews again with the same version.
    editTerms((t) => {
      t.sections![4].lines![0] = "You must be 18 or older to sign up.";
      t.lastUpdated = "2026-09-15";
    });
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-15"]);
    expect(() => run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-15"])).toThrow(/bump consentVersion/);
    expect(readTerms().publishedVersions).toEqual(signed);
    expect(plan().published).toBe(false);

    // Were counsel's record forged by hand under the old version, the app still refuses it.
    editTerms((t) => (t.counselReview = { reviewer: "Counsel Co.", date: "2026-09-15", version: "2026-09-10.1", sourceHash: t.englishReview!.sourceHash }));
    expect(plan().reasons).toEqual(["consent_version 2026-09-10.1 was already published with different text: bump consentVersion"]);

    editTerms((t) => (t.consentVersion = "2026-09-15.1"));
    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-15"]);
    expect(plan().reasons).toEqual([]);
    expect(Object.keys(readTerms().publishedVersions!)).toEqual(["2026-09-10.1", "2026-09-15.1"]);
  });

  it("refuses a review of changed text while lastUpdated has not moved past the review it replaces", () => {
    nameOwnerAndContact();
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-10"]);
    run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", "Counsel Co.", "--reviewed-on", "2026-09-10"]);

    editTerms((t) => (t.title = "Terms and your privacy"));
    expect(() => run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-15"])).toThrow(/lastUpdated/);
    expect(readTerms().englishReview?.date).toBe("2026-09-10");

    editTerms((t) => (t.lastUpdated = "2026-09-15"));
    run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-15"]);
    expect(readTerms().englishReview?.date).toBe("2026-09-15");
  });

  it("refuses a lastUpdated that predates the consent version's date, in the script", () => {
    nameOwnerAndContact();
    editTerms((t) => (t.consentVersion = "2026-09-20.1"));

    expect(() => run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", "Ana Reyes", "--reviewed-on", "2026-09-21"])).toThrow(/before the date of consentVersion/);
  });

  it("applies the app's required tokens to the terms in the status report and in --mark-reviewed", () => {
    run(STUB, ["--content", "--langs", "es"]);
    const status = () => JSON.parse(readFileSync(path.join(dir, "review", "content-translation-status.json"), "utf8")).es.problems as { id: string; problem: string }[];

    run(REVIEW, ["--content"]);
    const lost = status().filter((p) => p.problem.startsWith("lost required"));
    // The stub's answer to "Reply STOP..." keeps no STOP.
    expect(lost.map((p) => p.id)).toContain("terms.stop.0");
    expect(lost.find((p) => p.id === "terms.stop.0")!.problem).toContain("STOP");

    // A bulk mark skips that line and says so; the app then keeps showing English for it.
    const out = run(REVIEW, ["--content", "--mark-reviewed", "es", "--reviewer", "Wei Chen", "--reviewed-on", "2026-11-02"]);
    expect(out).toContain("not marked reviewed");
    expect(out).toContain("terms.stop.0");
    const file = JSON.parse(readFileSync(path.join(dir, "translations", "content", "es.json"), "utf8"));
    expect(file.texts["terms.stop.0"].status).toBe("machine");
    expect(file.texts["terms.title"].status).toBe("reviewed");

    // Asking for that line by name is refused outright.
    expect(() => run(REVIEW, ["--content", "--mark-reviewed", "es", "--reviewer", "Wei Chen", "--reviewed-on", "2026-11-02", "--keys", "terms.stop.0"])).toThrow(/lost STOP/);
  });

  it("refuses a review by the wrong person, a placeholder, a future date or one before the last update", () => {
    nameOwnerAndContact();
    const english = (reviewer: string, on: string) => () =>
      run(REVIEW, ["--content", "--mark-english-reviewed", "--terms", "--reviewer", reviewer, "--reviewed-on", on]);
    const counsel = (reviewer: string, on: string) => () =>
      run(REVIEW, ["--content", "--mark-counsel-reviewed", "--reviewer", reviewer, "--reviewed-on", on]);

    expect(english("Sam Lee", "2026-09-10")).toThrow();
    expect(english("PLACEHOLDER: later", "2026-09-10")).toThrow();
    expect(english("Ana Reyes", "2999-01-01")).toThrow();
    expect(english("Ana Reyes", "2026-09-09")).toThrow();
    expect(counsel("PLACEHOLDER: later", "2026-09-10")).toThrow();
    expect(counsel("Counsel Co.", "2999-01-01")).toThrow();
    expect(counsel("Counsel Co.", "2026-09-09")).toThrow();
    expect(readTerms().englishReview?.sourceHash).toBeUndefined();
    expect(readTerms().counselReview?.sourceHash).toBeNull();
  });
});
