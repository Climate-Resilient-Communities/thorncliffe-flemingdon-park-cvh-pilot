import { describe, expect, it } from "vitest";
import {
  ATTEMPT_STALE_MS,
  ATTEMPT_STATES,
  EntryStateSchema,
  LANGUAGE_RESULTS,
  RetranslateRequestSchema,
  SUBMIT_KEY_PATTERN,
  SUBMIT_STATES,
  SubmitRequestSchema,
  SubmitResultSchema,
} from "./alertSubmit";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";
const HASH = "a".repeat(64);

const entryState = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  server_now: "2026-10-04T14:00:00.000Z",
  entry: { id: ENTRY, alert_id: ALERT, kind: "ack", status: "pending_approval", version: 2, content_hash: HASH, possible_duplicate_of: null },
  attempt: {
    key: KEY,
    kind: "submit",
    state: "committed",
    outcome: null,
    started_at: "2026-10-04T13:59:10.000Z",
    finished_at: "2026-10-04T13:59:40.000Z",
    budget_ms: 35000,
    progress: { fr: "translated", ur: "fallback_en", "zh-Hant": "script_converted" },
    result_version: 2,
  },
  translations: [{ lang: "fr", status: "translated", machine: true }],
  ...overrides,
});

describe("the submit request", () => {
  it("has a version, the thread, the entry and the key of one press", () => {
    expect(SubmitRequestSchema.safeParse({ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEY }).success).toBe(true);
  });

  it("refuses a missing or other version, ids that are not ids, and a key that is not one a browser makes", () => {
    const ok = { v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEY };
    for (const bad of [{ ...ok, v: 2 }, { ...ok, v: undefined }, { ...ok, alert_id: "x" }, { ...ok, entry_id: 7 }, { ...ok, key: "short" }, { ...ok, key: "has spaces in it, sixteen+" }, { ...ok, key: "a".repeat(65) }, { ...ok, extra: 1 }]) {
      expect(SubmitRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("may name the fingerprint of the draft the author saved and saw, which must be a SHA-256, and nothing else", () => {
    const ok = { v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEY };
    expect(SubmitRequestSchema.safeParse({ ...ok, draft: HASH }).success).toBe(true);
    for (const bad of ["abc", "A".repeat(64), `${HASH}0`, 5, null]) expect(SubmitRequestSchema.safeParse({ ...ok, draft: bad }).success, String(bad)).toBe(false);
  });

  it("is told how long an attempt may be taken to be alive: 90 s, which the browser also waits for a sign of its key", () => {
    expect(ATTEMPT_STALE_MS).toBe(90_000);
  });

  it("accepts a key of 16 to 64 letters, digits, hyphens and underscores", () => {
    expect(SUBMIT_KEY_PATTERN.test("a".repeat(16))).toBe(true);
    expect(SUBMIT_KEY_PATTERN.test("a".repeat(64))).toBe(true);
    expect(SUBMIT_KEY_PATTERN.test("a".repeat(15))).toBe(false);
    expect(SUBMIT_KEY_PATTERN.test("Ab_-09".repeat(5))).toBe(true);
    expect(SUBMIT_KEY_PATTERN.test(`${"a".repeat(16)}\n`)).toBe(false);
  });
});

describe("the retranslate request", () => {
  it("is a submit request with the version and the hash the person was looking at", () => {
    const ok = { v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEY, seen_version: 2, seen_hash: HASH };
    expect(RetranslateRequestSchema.safeParse(ok).success).toBe(true);
    expect(RetranslateRequestSchema.safeParse({ ...ok, seen_version: 0 }).success).toBe(false);
    expect(RetranslateRequestSchema.safeParse({ ...ok, seen_hash: "abc" }).success).toBe(false);
    expect(RetranslateRequestSchema.safeParse({ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEY }).success).toBe(false);
  });

  it("names no draft: it works on the pending version, so a fingerprint of a draft is refused", () => {
    expect(RetranslateRequestSchema.safeParse({ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEY, seen_version: 2, seen_hash: HASH, draft: HASH }).success).toBe(false);
  });
});

describe("the entry's state", () => {
  it("is what the server stores, the latest attempt with each language's progress, and the frozen translations", () => {
    expect(EntryStateSchema.safeParse(entryState()).success).toBe(true);
    expect(EntryStateSchema.safeParse(entryState({ attempt: null, translations: [] })).success).toBe(true);
  });

  it("refuses a language that is not one of ours, a result that is not one of the three, and a body without a version", () => {
    const attempt = entryState().attempt;
    expect(EntryStateSchema.safeParse(entryState({ attempt: { ...attempt, progress: { xx: "translated" } } })).success).toBe(false);
    expect(EntryStateSchema.safeParse(entryState({ attempt: { ...attempt, progress: { fr: "source" } } })).success).toBe(false);
    expect(EntryStateSchema.safeParse(entryState({ v: undefined })).success).toBe(false);
    expect(EntryStateSchema.safeParse(entryState({ server_now: "yesterday" })).success).toBe(false);
  });

  it("carries a code for a failure, never text", () => {
    const attempt = entryState().attempt;
    expect(EntryStateSchema.safeParse(entryState({ attempt: { ...attempt, state: "failed", outcome: "ROUTES_UNAVAILABLE", result_version: null } })).success).toBe(true);
    expect(EntryStateSchema.safeParse(entryState({ attempt: { ...attempt, state: "failed", outcome: "the translation settings could not be read" } })).success).toBe(false);
  });

  it("has the three results a language can have: translated, converted from Mandarin or not translated", () => {
    expect([...LANGUAGE_RESULTS]).toEqual(["translated", "script_converted", "fallback_en"]);
    expect([...ATTEMPT_STATES]).toEqual(["running", "committed", "failed"]);
  });
});

describe("the submit result", () => {
  it("has a state for each way a press can end, all as a success body", () => {
    expect([...SUBMIT_STATES]).toEqual(["committed", "running", "failed", "refused"]);
    for (const state of SUBMIT_STATES) {
      expect(SubmitResultSchema.safeParse({ v: 1, state, outcome: state === "failed" || state === "refused" ? "DRAFT_CHANGED" : null, entry_state: entryState() }).success, state).toBe(true);
    }
  });

  it("allows no entry (a refusal for an entry that is not there) and refuses a state that is not one of the four", () => {
    expect(SubmitResultSchema.safeParse({ v: 1, state: "refused", outcome: "ENTRY_NOT_FOUND", entry_state: null }).success).toBe(true);
    expect(SubmitResultSchema.safeParse({ v: 1, state: "done", outcome: null, entry_state: null }).success).toBe(false);
  });
});
