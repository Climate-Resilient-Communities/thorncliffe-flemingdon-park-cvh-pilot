import { describe, expect, it } from "vitest";
import type { EntryState, SubmitReport } from "@/modules/alerting";
import { EntryStateSchema, SubmitResultSchema } from "@/contracts/alertSubmit";
import { entryStateBody, submitResultBody } from "./submitBody";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const OTHER = "01900000-0000-7000-8000-00000000e178";
const KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";
const NOW = new Date("2026-10-04T14:00:00.000Z");
const HASH = "c".repeat(64);

function stateOf(overrides: { attempt?: Partial<NonNullable<EntryState["attempt"]>> | null; entry?: Partial<EntryState["entry"]>; translations?: EntryState["translations"] } = {}): EntryState {
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:00:00.000Z"), status: "open" },
    entry: { id: ENTRY, alertId: ALERT, kind: "ack", status: "pending_approval", version: 2, contentHash: HASH, possibleDuplicateOf: OTHER, webPublishedAt: null, ...overrides.entry } as EntryState["entry"],
    attempt:
      overrides.attempt === null
        ? null
        : {
            key: KEY,
            kind: "submit",
            state: "committed",
            outcome: null,
            startedAt: new Date("2026-10-04T13:59:10.000Z"),
            finishedAt: new Date("2026-10-04T13:59:40.000Z"),
            budgetMs: 35000,
            progress: { fr: "translated", ur: "fallback_en" },
            resultVersion: 2,
            resultHash: HASH,
            ...overrides.attempt,
          },
    translations: overrides.translations ?? [{ lang: "fr", status: "translated", machine: true }],
  };
}

describe("entryStateBody", () => {
  it("is nothing for an entry that is not there", () => {
    expect(entryStateBody(null, NOW)).toBeNull();
  });

  it("carries what is stored, the latest attempt with its progress, the frozen translations and the possible duplicate, as the wire says it", () => {
    const body = entryStateBody(stateOf(), NOW);
    expect(body).toEqual({
      v: 1,
      server_now: "2026-10-04T14:00:00.000Z",
      entry: { id: ENTRY, alert_id: ALERT, kind: "ack", status: "pending_approval", version: 2, content_hash: HASH, possible_duplicate_of: OTHER, web_published: false },
      attempt: {
        key: KEY,
        kind: "submit",
        state: "committed",
        outcome: null,
        started_at: "2026-10-04T13:59:10.000Z",
        finished_at: "2026-10-04T13:59:40.000Z",
        budget_ms: 35000,
        progress: { fr: "translated", ur: "fallback_en" },
        result_version: 2,
      },
      translations: [{ lang: "fr", status: "translated", machine: true }],
    });
    expect(EntryStateSchema.safeParse(body).success).toBe(true);
  });

  it("says residents already read an entry that went on the web at its submit (a D-1 post, S08.04), and still passes its own schema", () => {
    const body = entryStateBody(stateOf({ entry: { webPublishedAt: new Date("2026-10-04T13:59:40.000Z") } }), NOW);
    expect(body?.entry.web_published).toBe(true);
    expect(EntryStateSchema.safeParse(body).success).toBe(true);
    // A body built before the field existed is still read.
    const older = { ...body!.entry } as Record<string, unknown>;
    delete older.web_published;
    expect(EntryStateSchema.safeParse({ ...body, entry: older }).success).toBe(true);
  });

  it("has no attempt for an entry nobody has submitted, and a running attempt's unfinished time as null", () => {
    expect(entryStateBody(stateOf({ attempt: null, entry: { status: "draft", version: 0, contentHash: null, possibleDuplicateOf: null }, translations: [] }), NOW)?.attempt).toBeNull();
    const running = entryStateBody(stateOf({ attempt: { state: "running", finishedAt: null, resultVersion: null, resultHash: null, progress: {} } }), NOW);
    expect(running?.attempt).toMatchObject({ state: "running", finished_at: null, result_version: null, progress: {} });
  });

  it("leaves out a language or a result the contract does not know, rather than sending a body its own schema refuses", () => {
    const body = entryStateBody(
      stateOf({ attempt: { progress: { fr: "translated", xx: "translated", de: "weird" } }, translations: [{ lang: "xx", status: "translated", machine: true }, { lang: "ur", status: "weird", machine: true }, { lang: "ta", status: "script_converted", machine: true }] }),
      NOW,
    );
    expect(body?.attempt?.progress).toEqual({ fr: "translated" });
    expect(body?.translations).toEqual([{ lang: "ta", status: "script_converted", machine: true }]);
  });
});

describe("submitResultBody", () => {
  it("says an attempt's state and, for a failed one, why", () => {
    const failed: SubmitReport = { state: "failed", key: KEY, outcome: "ROUTES_UNAVAILABLE" };
    const body = submitResultBody(failed, stateOf({ attempt: { state: "failed", outcome: "ROUTES_UNAVAILABLE", resultVersion: null } , entry: { status: "draft", version: 0, contentHash: null }, translations: [] }), NOW);
    expect(body).toMatchObject({ v: 1, state: "failed", outcome: "ROUTES_UNAVAILABLE" });
    expect(body.entry_state?.entry.status).toBe("draft");
    expect(SubmitResultSchema.safeParse(body).success).toBe(true);
  });

  it("has no outcome for a committed or a running attempt", () => {
    expect(submitResultBody({ state: "committed", key: KEY, outcome: null }, stateOf(), NOW)).toMatchObject({ state: "committed", outcome: null });
    expect(submitResultBody({ state: "running", key: KEY, outcome: null }, stateOf({ attempt: { state: "running" } }), NOW).state).toBe("running");
  });

  it("says why a press was refused before anything started, whether or not the entry exists", () => {
    expect(submitResultBody({ state: "refused", refusal: "SUBMIT_IN_PROGRESS" }, stateOf(), NOW)).toMatchObject({ state: "refused", outcome: "SUBMIT_IN_PROGRESS" });
    expect(submitResultBody({ state: "refused", refusal: "ENTRY_NOT_FOUND" }, null, NOW)).toEqual({ v: 1, state: "refused", outcome: "ENTRY_NOT_FOUND", entry_state: null });
  });
});
