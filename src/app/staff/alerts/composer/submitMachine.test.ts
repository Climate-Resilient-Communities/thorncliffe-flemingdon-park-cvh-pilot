import { describe, expect, it } from "vitest";
import type { EntryState, SubmitResult } from "@/contracts/alertSubmit";
import { UNCONFIRMED_WINDOW_MS, doneCount, initialSubmitUi, submitReducer, unconfirmedOf, type SubmitEvent, type SubmitUi } from "./submitMachine";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";
const OTHER_KEY = "ffffffff-0b0a-4908-8706-050403020100";
const T0 = 5_000;

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
const answered = (value: SubmitResult, at = T0): SubmitEvent => ({ type: "answered", result: value, at });
const polled = (value: EntryState | null, at: number): SubmitEvent => ({ type: "polled", state: value, at });

const IDLE: SubmitUi = { phase: "idle", message: null, unconfirmed: null };
const run = (events: SubmitEvent[], from: SubmitUi = IDLE) => events.reduce(submitReducer, from);
const sent: SubmitEvent = { type: "sent", key: KEY, kind: "submit" };
const SENT_UI: SubmitUi = { phase: "running", key: KEY, kind: "submit", budgetMs: null, progress: {}, awaiting: "answer", lost: false, own: true, since: null };

describe("pressing Submit", () => {
  it("saves first, then sends with a key, and shows progress from nothing", () => {
    expect(run([{ type: "saving" }])).toEqual({ phase: "saving", unconfirmed: null });
    expect(run([{ type: "saving" }, sent])).toEqual(SENT_UI);
  });

  it("goes back to the form, with nothing running, when the draft could not be saved", () => {
    expect(run([{ type: "saving" }, { type: "save_stopped" }])).toEqual(IDLE);
  });

  it("keeps the key whose outcome was never confirmed through a save that stops, and through the saving itself", () => {
    const unconfirmed = { key: KEY, kind: "submit" as const };
    const waiting: SubmitUi = { phase: "idle", message: "NOT_REACHED", unconfirmed };
    expect(run([{ type: "saving" }], waiting)).toEqual({ phase: "saving", unconfirmed });
    expect(run([{ type: "saving" }, { type: "save_stopped" }], waiting)).toEqual({ phase: "idle", message: null, unconfirmed });
  });
});

describe("the answer to the press", () => {
  it("ends committed when the entry was frozen and failed when nothing was; the page is then loaded again", () => {
    expect(run([sent, answered(result("committed", state({ state: "committed" }, { status: "pending_approval", version: 1 })))])).toEqual({ phase: "ended", outcome: "committed" });
    expect(run([sent, answered(result("failed", state({ state: "failed", outcome: "ROUTES_UNAVAILABLE" }), "ROUTES_UNAVAILABLE"))])).toEqual({ phase: "ended", outcome: "failed" });
  });

  it("goes back to the form with the code of a refusal, nothing having started, and so with no key left unconfirmed", () => {
    expect(run([sent, answered(result("refused", state(null), "DRAFT_CHANGED"))])).toEqual({ phase: "idle", message: "DRAFT_CHANGED", unconfirmed: null });
    expect(run([sent, answered(result("refused", null, "ENTRY_NOT_FOUND"))])).toEqual({ phase: "idle", message: "ENTRY_NOT_FOUND", unconfirmed: null });
  });

  it("follows the attempt that is running when the press was refused because one was (SUBMIT_IN_PROGRESS), so the page loads when it ends", () => {
    const running = state({ key: OTHER_KEY, kind: "retranslate", progress: { fr: "translated" }, budget_ms: 30000 });
    const next = run([sent, answered(result("refused", running, "SUBMIT_IN_PROGRESS"))]);

    expect(next).toEqual({ phase: "running", key: OTHER_KEY, kind: "retranslate", budgetMs: 30000, progress: { fr: "translated" }, awaiting: "state", lost: false, own: false, since: T0 });
    // It is not this press's key, so nothing of it is kept to send again.
    expect(unconfirmedOf(next)).toBeNull();
    // And the polls take it to its end.
    expect(submitReducer(next, polled(state({ key: OTHER_KEY, state: "committed" }, { status: "pending_approval", version: 2 }), T0 + 1000))).toEqual({ phase: "ended", outcome: "committed" });
    expect(submitReducer(next, polled(state({ key: OTHER_KEY, kind: "retranslate", progress: { fr: "translated", ur: "fallback_en" } }), T0 + 1000))).toMatchObject({ phase: "running", key: OTHER_KEY, progress: { fr: "translated", ur: "fallback_en" } });
  });

  it("goes back to the form when it was refused for being in progress but the state shows no running attempt (it ended meanwhile)", () => {
    expect(run([sent, answered(result("refused", state({ key: OTHER_KEY, state: "committed" }), "SUBMIT_IN_PROGRESS"))])).toEqual({ phase: "idle", message: "SUBMIT_IN_PROGRESS", unconfirmed: null });
    expect(run([sent, answered(result("refused", null, "SUBMIT_IN_PROGRESS"))])).toEqual({ phase: "idle", message: "SUBMIT_IN_PROGRESS", unconfirmed: null });
  });

  it("shows the progress of the same key when it is still running (the key was already running), and goes by the state from there on", () => {
    const next = run([sent, answered(result("running", state({ progress: { fr: "translated", ur: "fallback_en" }, budget_ms: 35000 })))]);
    expect(next).toMatchObject({ phase: "running", key: KEY, budgetMs: 35000, progress: { fr: "translated", ur: "fallback_en" }, awaiting: "state", lost: false, own: true, since: T0 });
    // The server has shown it knows the key: it is no longer unconfirmed.
    expect(unconfirmedOf(next)).toBeNull();
  });

  it("does not take another key's attempt for this press", () => {
    const next = run([sent, answered(result("running", state({ key: OTHER_KEY, progress: { fr: "translated" } })))]);
    expect(next).toMatchObject({ phase: "running", key: KEY, progress: {} });
  });

  it("ignores an answer when nothing is running (a late answer after the screen moved on)", () => {
    expect(submitReducer(IDLE, answered(result("committed", state({ state: "committed" }))))).toBe(IDLE);
  });
});

describe("a lost connection: the answer was not seen", () => {
  const lost = () => run([sent, { type: "lost", at: T0 }]);

  it("says it is checking, keeps the key unconfirmed, and goes by the entry's state", () => {
    expect(lost()).toMatchObject({ phase: "running", awaiting: "state", lost: true, own: true, since: T0 });
    expect(unconfirmedOf(lost())).toEqual({ key: KEY, kind: "submit" });
    expect(submitReducer(lost(), polled(state({ state: "committed" }, { status: "pending_approval", version: 1 }), T0 + 1000))).toEqual({ phase: "ended", outcome: "committed" });
    expect(submitReducer(lost(), polled(state({ state: "failed", outcome: "SMS_BODY_TOO_LONG" }), T0 + 1000))).toEqual({ phase: "ended", outcome: "failed" });
  });

  it("shows progress for the same key while the attempt is still running, and no longer says it is lost once it is seen", () => {
    const next = submitReducer(lost(), polled(state({ progress: { fr: "translated" } }), T0 + 1000));
    expect(next).toMatchObject({ phase: "running", progress: { fr: "translated" }, budgetMs: 35000, lost: false, since: T0 + 1000 });
    expect(unconfirmedOf(next)).toBeNull();
  });

  it("waits for a request that arrives late: no sign of the key for most of an attempt's life is not yet 'it never arrived', and its late arrival is followed to the end", () => {
    let ui = lost();
    // A minute with no sign of the key (the request is waiting for the thread's lock, a cold start, the connection).
    for (let second = 1; second <= 60; second += 1) ui = submitReducer(ui, polled(state(null), T0 + second * 1000));
    expect(ui).toMatchObject({ phase: "running", lost: true, awaiting: "state" });
    expect(unconfirmedOf(ui)).toEqual({ key: KEY, kind: "submit" });

    // The request arrives, and runs.
    ui = submitReducer(ui, polled(state({ progress: { fr: "translated" } }), T0 + 61_000));
    expect(ui).toMatchObject({ phase: "running", progress: { fr: "translated" }, lost: false });
    ui = submitReducer(ui, polled(state({ progress: { fr: "translated", ur: "translated" } }), T0 + 70_000));
    expect(ui).toMatchObject({ phase: "running", progress: { fr: "translated", ur: "translated" } });
    expect(submitReducer(ui, polled(state({ state: "committed" }, { status: "pending_approval", version: 1 }), T0 + 75_000))).toEqual({ phase: "ended", outcome: "committed" });
  });

  it("says the request could not be confirmed only after the whole life an attempt can have, and keeps the key for the next press", () => {
    let ui = lost();
    for (let second = 1; second < UNCONFIRMED_WINDOW_MS / 1000; second += 1) {
      ui = submitReducer(ui, polled(state(null), T0 + second * 1000));
      expect(ui, `second ${second}`).toMatchObject({ phase: "running" });
    }
    const gaveUp = submitReducer(ui, polled(state(null), T0 + UNCONFIRMED_WINDOW_MS));

    expect(gaveUp).toEqual({ phase: "idle", message: "NOT_REACHED", unconfirmed: { key: KEY, kind: "submit" } });
    expect(unconfirmedOf(gaveUp)).toEqual({ key: KEY, kind: "submit" });
  });

  it("is as long as the server itself waits before it reads a running attempt as abandoned", () => {
    expect(UNCONFIRMED_WINDOW_MS).toBe(90_000);
  });

  it("counts another key's attempt, and a state that cannot be read, as no sign of this one", () => {
    let other = lost();
    other = submitReducer(other, polled(state({ key: OTHER_KEY, state: "committed" }), T0 + 10_000));
    expect(other).toMatchObject({ phase: "running" });
    expect(submitReducer(other, polled(state({ key: OTHER_KEY, state: "committed" }), T0 + UNCONFIRMED_WINDOW_MS))).toMatchObject({ phase: "idle", message: "NOT_REACHED" });
    expect(submitReducer(lost(), polled(null, T0 + UNCONFIRMED_WINDOW_MS))).toMatchObject({ phase: "idle", message: "NOT_REACHED", unconfirmed: { key: KEY } });
  });

  it("counts the window from the last sign of life: an attempt seen and then not readable for the whole window is not confirmed either", () => {
    let ui = submitReducer(lost(), polled(state({ progress: { fr: "translated" } }), T0 + 30_000));
    ui = submitReducer(ui, polled(null, T0 + 30_000 + UNCONFIRMED_WINDOW_MS - 1));
    expect(ui).toMatchObject({ phase: "running" });
    expect(submitReducer(ui, polled(null, T0 + 30_000 + UNCONFIRMED_WINDOW_MS))).toMatchObject({ phase: "idle", message: "NOT_REACHED", unconfirmed: { key: KEY } });
  });

  it("does not give up while a request is still waiting for its answer: that answer comes, or is lost", () => {
    let ui: SubmitUi = run([sent]);
    for (let second = 1; second <= 200; second += 1) ui = submitReducer(ui, polled(state(null), T0 + second * 1000));
    expect(ui).toMatchObject({ phase: "running", awaiting: "answer", lost: false });
    // It is the key that is kept while the request is in flight, so a page loaded again in that time sends it again.
    expect(unconfirmedOf(ui)).toEqual({ key: KEY, kind: "submit" });
  });

  it("follows an attempt it did not make to its end, and gives up on it without keeping its key (it is not this press's to send again)", () => {
    const followed = run([sent, answered(result("refused", state({ key: OTHER_KEY }), "SUBMIT_IN_PROGRESS"))]);
    const gaveUp = submitReducer(followed, polled(null, T0 + UNCONFIRMED_WINDOW_MS));
    expect(gaveUp).toEqual({ phase: "idle", message: "NOT_REACHED", unconfirmed: null });
  });

  it("ignores a lost connection or a poll when nothing is running", () => {
    expect(submitReducer(IDLE, { type: "lost", at: T0 })).toBe(IDLE);
    expect(submitReducer(IDLE, polled(state({ state: "committed" }), T0))).toBe(IDLE);
  });
});

describe("a key that was not confirmed, pressed again", () => {
  const unconfirmed = { key: KEY, kind: "submit" as const };
  const waiting: SubmitUi = { phase: "idle", message: "NOT_REACHED", unconfirmed };

  it("is sent again as the same key, and the first attempt's result is what follows", () => {
    const again = submitReducer(waiting, sent);
    expect(again).toMatchObject({ phase: "running", key: KEY, own: true, awaiting: "answer" });
    expect(submitReducer(again, answered(result("running", state({ progress: { fr: "translated" } }))))).toMatchObject({ phase: "running", key: KEY, progress: { fr: "translated" } });
    expect(submitReducer(again, answered(result("committed", state({ state: "committed" }, { status: "pending_approval", version: 1 }))))).toEqual({ phase: "ended", outcome: "committed" });
    expect(submitReducer(again, answered(result("failed", state({ state: "failed", outcome: "DRAFT_CHANGED" }), "DRAFT_CHANGED")))).toEqual({ phase: "ended", outcome: "failed" });
  });

  it("is followed to the server's state when the server turns out to know it (asked before it is sent again)", () => {
    expect(submitReducer(waiting, { type: "known", key: KEY, kind: "submit", state: state({ state: "committed" }, { status: "pending_approval", version: 1 }), at: T0 })).toEqual({ phase: "ended", outcome: "committed" });
    expect(submitReducer(waiting, { type: "known", key: KEY, kind: "submit", state: state({ state: "failed", outcome: "SUBMIT_ABANDONED" }), at: T0 })).toEqual({ phase: "ended", outcome: "failed" });
    const running = submitReducer(waiting, { type: "known", key: KEY, kind: "submit", state: state({ progress: { fr: "translated" } }), at: T0 });
    expect(running).toMatchObject({ phase: "running", key: KEY, awaiting: "state", lost: false, own: true, progress: { fr: "translated" } });
    expect(unconfirmedOf(running)).toBeNull();
  });
});

describe("coming back to an entry that is being submitted, or one with a key kept", () => {
  it("starts on the running attempt, with the progress the server has, which is not this tab's to send again", () => {
    const start = initialSubmitUi({ key: KEY, kind: "retranslate", budgetMs: 35000, progress: { fr: "translated" } });
    expect(start).toEqual({ phase: "running", key: KEY, kind: "retranslate", budgetMs: 35000, progress: { fr: "translated" }, awaiting: "state", lost: false, own: false, since: null });
    expect(unconfirmedOf(start)).toBeNull();
    // The first poll that shows nothing starts its window; the attempt, once seen, goes on.
    expect(submitReducer(start, polled(state(null), T0))).toMatchObject({ phase: "running", since: T0 });
    expect(submitReducer(start, polled(state({ key: KEY, state: "committed" }), T0))).toEqual({ phase: "ended", outcome: "committed" });
  });

  it("starts idle, with the key kept by this tab (if any) to send again", () => {
    expect(initialSubmitUi(null)).toEqual(IDLE);
    expect(initialSubmitUi(null, { key: KEY, kind: "submit" })).toEqual({ phase: "idle", message: null, unconfirmed: { key: KEY, kind: "submit" } });
  });

  it("takes a key remembered after the start only when there is none and nothing runs", () => {
    expect(submitReducer(IDLE, { type: "remembered", unconfirmed: { key: KEY, kind: "submit" } })).toEqual({ phase: "idle", message: null, unconfirmed: { key: KEY, kind: "submit" } });
    const kept: SubmitUi = { phase: "idle", message: null, unconfirmed: { key: OTHER_KEY, kind: "submit" } };
    expect(submitReducer(kept, { type: "remembered", unconfirmed: { key: KEY, kind: "submit" } })).toBe(kept);
    expect(submitReducer(SENT_UI, { type: "remembered", unconfirmed: { key: OTHER_KEY, kind: "submit" } })).toBe(SENT_UI);
  });
});

describe("the key of a press that is not confirmed", () => {
  it("is the key from the moment it is sent until the server's own answer or state shows it, and none otherwise", () => {
    expect(unconfirmedOf(IDLE)).toBeNull();
    expect(unconfirmedOf(SENT_UI)).toEqual({ key: KEY, kind: "submit" });
    expect(unconfirmedOf({ phase: "ended", outcome: "committed" })).toBeNull();
    expect(unconfirmedOf({ phase: "saving", unconfirmed: { key: KEY, kind: "retranslate" } })).toEqual({ key: KEY, kind: "retranslate" });
    expect(unconfirmedOf({ ...SENT_UI, own: false })).toBeNull();
  });
});

describe("what the screen asks of the machine", () => {
  it("counts the languages that have settled", () => {
    expect(doneCount({})).toBe(0);
    expect(doneCount({ fr: "translated", ur: "fallback_en" })).toBe(2);
  });
});
