import { describe, expect, it } from "vitest";
import type { EntryState, SubmitResult } from "@/contracts/alertSubmit";
import { UNSEEN_POLLS_BEFORE_GIVING_UP, doneCount, initialSubmitUi, shouldPoll, submitReducer, type SubmitEvent, type SubmitUi } from "./submitMachine";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";
const OTHER_KEY = "ffffffff-0b0a-4908-8706-050403020100";

function state(attempt: Partial<NonNullable<EntryState["attempt"]>> | null, entry: Partial<EntryState["entry"]> = {}): EntryState {
  return {
    v: 1,
    server_now: "2026-10-04T14:00:00.000Z",
    entry: { id: ENTRY, alert_id: ALERT, kind: "ack", status: "draft", version: 0, content_hash: null, possible_duplicate_of: null, ...entry },
    attempt:
      attempt === null
        ? null
        : { key: KEY, kind: "submit", state: "running", outcome: null, started_at: "2026-10-04T13:59:10.000Z", finished_at: null, budget_ms: 35000, progress: {}, result_version: null, ...attempt },
    translations: [],
  };
}
const result = (stateName: SubmitResult["state"], entry: EntryState | null, outcome: string | null = null): SubmitResult => ({ v: 1, state: stateName, outcome, entry_state: entry });

const run = (events: SubmitEvent[], from: SubmitUi = { phase: "idle", message: null }) => events.reduce(submitReducer, from);
const sent: SubmitEvent = { type: "sent", key: KEY, kind: "submit" };

describe("pressing Submit", () => {
  it("saves first, then sends with a key, and shows progress from nothing", () => {
    expect(run([{ type: "saving" }])).toEqual({ phase: "saving" });
    expect(run([{ type: "saving" }, sent])).toEqual({ phase: "running", key: KEY, kind: "submit", budgetMs: null, progress: {}, lost: false, unseen: 0 });
  });

  it("goes back to the form, with nothing running, when the draft could not be saved", () => {
    expect(run([{ type: "saving" }, { type: "save_stopped" }])).toEqual({ phase: "idle", message: null });
  });
});

describe("the answer to the press", () => {
  it("ends committed when the entry was frozen and failed when nothing was; the page is then loaded again", () => {
    expect(run([sent, { type: "answered", result: result("committed", state({ state: "committed" }, { status: "pending_approval", version: 1 })) }])).toEqual({ phase: "ended", outcome: "committed" });
    expect(run([sent, { type: "answered", result: result("failed", state({ state: "failed", outcome: "ROUTES_UNAVAILABLE" }), "ROUTES_UNAVAILABLE") }])).toEqual({ phase: "ended", outcome: "failed" });
  });

  it("goes back to the form with the code of a refusal, nothing having started", () => {
    expect(run([sent, { type: "answered", result: result("refused", state(null), "SUBMIT_IN_PROGRESS") }])).toEqual({ phase: "idle", message: "SUBMIT_IN_PROGRESS" });
    expect(run([sent, { type: "answered", result: result("refused", null, "ENTRY_NOT_FOUND") }])).toEqual({ phase: "idle", message: "ENTRY_NOT_FOUND" });
  });

  it("shows the progress of the same key when it is still running (the key was already running)", () => {
    const next = run([sent, { type: "answered", result: result("running", state({ progress: { fr: "translated", ur: "fallback_en" }, budget_ms: 35000 })) }]);
    expect(next).toMatchObject({ phase: "running", key: KEY, budgetMs: 35000, progress: { fr: "translated", ur: "fallback_en" }, lost: false });
  });

  it("does not take another key's attempt for this press", () => {
    const next = run([sent, { type: "answered", result: result("running", state({ key: OTHER_KEY, progress: { fr: "translated" } })) }]);
    expect(next).toMatchObject({ phase: "running", key: KEY, progress: {} });
  });

  it("ignores an answer when nothing is running (a late answer after the screen moved on)", () => {
    const idle: SubmitUi = { phase: "idle", message: null };
    expect(submitReducer(idle, { type: "answered", result: result("committed", state({ state: "committed" })) })).toBe(idle);
  });
});

describe("a lost connection: the answer was not seen", () => {
  it("says it is checking, and goes by the entry's state", () => {
    const lost = run([sent, { type: "lost" }]);
    expect(lost).toMatchObject({ phase: "running", lost: true });
    expect(run([{ type: "polled", state: state({ state: "committed" }, { status: "pending_approval", version: 1 }) }], lost)).toEqual({ phase: "ended", outcome: "committed" });
    expect(run([{ type: "polled", state: state({ state: "failed", outcome: "SMS_BODY_TOO_LONG" }) }], lost)).toEqual({ phase: "ended", outcome: "failed" });
  });

  it("shows progress for the same key while the attempt is still running, and no longer says it is lost once it is seen", () => {
    const lost = run([sent, { type: "lost" }]);
    const next = run([{ type: "polled", state: state({ progress: { fr: "translated" } }) }], lost);
    expect(next).toMatchObject({ phase: "running", progress: { fr: "translated" }, budgetMs: 35000, unseen: 0 });
  });

  it("gives up after a few polls that find no attempt for the key: the request never arrived, nothing was submitted", () => {
    let ui = run([sent, { type: "lost" }]);
    for (let poll = 1; poll < UNSEEN_POLLS_BEFORE_GIVING_UP; poll += 1) {
      ui = submitReducer(ui, { type: "polled", state: state(null) });
      expect(ui, `poll ${poll}`).toMatchObject({ phase: "running", unseen: poll });
    }
    expect(submitReducer(ui, { type: "polled", state: state(null) })).toEqual({ phase: "idle", message: "NOT_REACHED" });
  });

  it("does not give up on an attempt it has not lost the answer to, and counts another key's attempt as no attempt", () => {
    let ui: SubmitUi = run([sent]);
    for (let poll = 0; poll < UNSEEN_POLLS_BEFORE_GIVING_UP + 2; poll += 1) ui = submitReducer(ui, { type: "polled", state: state({ key: OTHER_KEY, state: "committed" }) });
    expect(ui).toMatchObject({ phase: "running" });
    ui = submitReducer(ui, { type: "lost" });
    expect(submitReducer(ui, { type: "polled", state: state({ key: OTHER_KEY, state: "committed" }) })).toEqual({ phase: "idle", message: "NOT_REACHED" });
  });

  it("counts an entry that cannot be read as no attempt", () => {
    let ui = run([sent, { type: "lost" }]);
    for (let poll = 0; poll < UNSEEN_POLLS_BEFORE_GIVING_UP; poll += 1) ui = submitReducer(ui, { type: "polled", state: null });
    expect(ui).toEqual({ phase: "idle", message: "NOT_REACHED" });
  });

  it("ignores a lost connection or a poll when nothing is running", () => {
    const idle: SubmitUi = { phase: "idle", message: null };
    expect(submitReducer(idle, { type: "lost" })).toBe(idle);
    expect(submitReducer(idle, { type: "polled", state: state({ state: "committed" }) })).toBe(idle);
  });
});

describe("coming back to an entry that is being submitted", () => {
  it("starts on the running attempt, with the progress the server has", () => {
    expect(initialSubmitUi({ key: KEY, kind: "retranslate", budgetMs: 35000, progress: { fr: "translated" } })).toEqual({
      phase: "running",
      key: KEY,
      kind: "retranslate",
      budgetMs: 35000,
      progress: { fr: "translated" },
      lost: false,
      unseen: 0,
    });
    expect(initialSubmitUi(null)).toEqual({ phase: "idle", message: null });
  });
});

describe("what the screen asks of the machine", () => {
  it("counts the languages that have settled and polls only while an attempt is running", () => {
    expect(doneCount({})).toBe(0);
    expect(doneCount({ fr: "translated", ur: "fallback_en" })).toBe(2);
    expect(shouldPoll({ phase: "idle", message: null })).toBe(false);
    expect(shouldPoll({ phase: "saving" })).toBe(false);
    expect(shouldPoll(run([sent]))).toBe(true);
    expect(shouldPoll({ phase: "ended", outcome: "committed" })).toBe(false);
  });
});
