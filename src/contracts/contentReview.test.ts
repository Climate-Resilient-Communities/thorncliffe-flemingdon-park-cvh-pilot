import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateTranslation, safetyCriticalTerms, type TranslationRecord } from "./contentReview";

const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const ENGLISH = "Open Mon-Fri 9:30 a.m.-4:30 p.m. at 30 Thorncliffe Park Dr, M4H 1L1. Call 416-421-0792 or email info@example.org; see https://example.org/help.";
const URDU = "پیر تا جمعہ 9:30 a.m.-4:30 p.m. کھلا، 30 Thorncliffe Park Dr, M4H 1L1۔ 416-421-0792 پر کال کریں یا info@example.org پر ای میل کریں؛ https://example.org/help دیکھیں۔";

describe("evaluateTranslation with allowMachine", () => {
  const files = (record: TranslationRecord, zh?: TranslationRecord) => ({
    ur: { texts: { k: record } },
    ...(zh ? { zh: { texts: { k: zh } }, "zh-Hant": { texts: { k: record } } } : {}),
  });
  const machine = (change: Partial<TranslationRecord> = {}): TranslationRecord => ({ text: URDU, model: "m", sourceHash: hash(ENGLISH), ...change });

  it("does not load a machine translation without it (the guides, terms, emergency roles and names)", () => {
    expect(evaluateTranslation("ur", "k", ENGLISH, files(machine()), hash)).toEqual({ unavailable: "machine" });
  });

  it("loads a current machine translation as `machine`, never with a reviewer", () => {
    const result = evaluateTranslation("ur", "k", ENGLISH, files(machine({ machineChecks: ["line_review"] })), hash, ["911"], { allowMachine: true });
    expect(result).toEqual({ loaded: { text: URDU, provenance: { model: "m", status: "machine", sourceHash: hash(ENGLISH), machineChecks: ["line_review"] } } });
  });

  it("still refuses a stale one, and one whose facts changed", () => {
    expect(evaluateTranslation("ur", "k", ENGLISH, files(machine({ sourceHash: hash("older") })), hash, [], { allowMachine: true })).toEqual({ unavailable: "stale" });
    expect(evaluateTranslation("ur", "k", ENGLISH, files(machine({ text: URDU.replace("0792", "0729") })), hash, [], { allowMachine: true })).toEqual({ unavailable: "facts_changed" });
  });

  it("keeps a reviewed translation as it was: no facts check, the review recorded", () => {
    const result = evaluateTranslation("ur", "k", ENGLISH, files(machine({ text: "x", status: "reviewed", reviewer: "Ayesha", reviewedOn: "2026-11-02" })), hash, [], { allowMachine: true });
    expect(result).toMatchObject({ loaded: { provenance: { status: "reviewed", reviewer: "Ayesha", reviewedOn: "2026-11-02" } } });
  });

  it("loads a zh-Hant conversion of a machine zh only as machine, and a reviewed one only from a reviewed zh", () => {
    const zh = machine({ text: "周一至周五 9:30 a.m.-4:30 p.m. 30 Thorncliffe Park Dr, M4H 1L1 416-421-0792 info@example.org https://example.org/help" });
    const conversion = { from: "zh", fromTextHash: hash(zh.text!), openccVersion: "1.0", config: "s2t" };
    const hant = { ...zh, text: "週一至週五 9:30 a.m.-4:30 p.m. 30 Thorncliffe Park Dr, M4H 1L1 416-421-0792 info@example.org https://example.org/help", conversion };
    const both = { zh: { texts: { k: zh } }, "zh-Hant": { texts: { k: hant } } };
    expect(evaluateTranslation("zh-Hant", "k", ENGLISH, both, hash, [], { allowMachine: true })).toMatchObject({ loaded: { provenance: { status: "machine" } } });
    expect(evaluateTranslation("zh-Hant", "k", ENGLISH, both, hash)).toEqual({ unavailable: "machine" });
    const claimsReviewed = { zh: { texts: { k: zh } }, "zh-Hant": { texts: { k: { ...hant, status: "reviewed" as const, reviewer: "Wei", reviewedOn: "2026-11-02" } } } };
    expect(evaluateTranslation("zh-Hant", "k", ENGLISH, claimsReviewed, hash, [], { allowMachine: true })).toEqual({ unavailable: "zh_changed_or_not_reviewed" });
  });
});

describe("safetyCriticalTerms (product owner, 2026-10-03: crisis and emergency lines keep human review)", () => {
  it.each([
    ["Call 911 in an emergency.", "911"],
    ["Call or text 988, the suicide crisis helpline.", "988"],
    ["Kids Help Phone 1-800-668-6868 for young people.", "Kids Help Phone"],
    ["Talk Suicide Canada 1-833-456-4566.", "suicide"],
    ["Distress Centres of Greater Toronto 416-408-4357.", "distress"],
    ["Assaulted Women's Helpline 416-863-0511.", "helpline"],
    ["Toronto Rape Crisis Centre 416-597-8808.", "rape"],
    ["A 24-hour mental health crisis line.", "crisis"],
    ["Naseeha Mental Health Hotline.", "hotline"],
    ["The hospital's emergency department at 825 Coxwell Ave.", "emergency line or department"],
    ["Non-emergency line: 416-338-9050.", "non-emergency"],
    ["Free naloxone kits and overdose prevention.", "overdose"],
    ["Ontario Poison Centre 1-800-268-9017.", "poison"],
  ])("catches %s", (english, term) => {
    expect(safetyCriticalTerms(english)).toContain(term);
  });

  it.each([
    "Emergency Energy Fund applications for overdue utility bills.",
    "Emergency food hampers every Tuesday.",
    "An emergency shelter referral desk.",
    "Midwives are on call 24/7 for urgent concerns.",
    "Individual and family counselling and mental health services.",
    "Violence-against-women counselling and youth violence prevention.",
    "Advocacy on the housing crisis and the affordability crisis.",
    "Free groceries every Tuesday and Friday.",
  ])("does not sweep up ordinary text: %s", (english) => {
    expect(safetyCriticalTerms(english)).toEqual([]);
  });

  it("refuses an unreviewed machine translation of safety-critical English, however faithful, and still loads a reviewed one", () => {
    const english = "Kids Help Phone 1-800-668-6868, 24 hours.";
    const record = { text: "Kids Help Phone 1-800-668-6868، 24 گھنٹے۔", model: "m", sourceHash: hash(english) };
    expect(evaluateTranslation("ur", "k", english, { ur: { texts: { k: record } } }, hash, ["911"], { allowMachine: true })).toEqual({ unavailable: "safety_critical" });
    const reviewed = { ...record, status: "reviewed" as const, reviewer: "Ayesha", reviewedOn: "2026-11-02" };
    expect(evaluateTranslation("ur", "k", english, { ur: { texts: { k: reviewed } } }, hash, ["911"], { allowMachine: true })).toMatchObject({ loaded: { provenance: { status: "reviewed" } } });
  });
});
