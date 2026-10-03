// The calls a press of Submit makes, in order, against a fake server (S04.05): which key goes out, when the server is asked about an earlier
// key first, and what a press that follows a lost answer does. The fake server keeps what the real one keeps: an attempt per key, the first
// result for a key it has seen, and one running attempt per entry. Together with submitMachine.test.ts this is the browser's side of "a new
// key is used only after a confirmed failure", without a browser.
import { describe, expect, it } from "vitest";
import type { EntryState, SubmitRequest, SubmitResult } from "@/contracts/alertSubmit";
import type { ComposeState } from "./editDraft";
import type { SubmitApi } from "./submitClient";
import { UNCONFIRMED_WINDOW_MS, initialSubmitUi, submitReducer, unconfirmedOf, type SubmitEvent, type SubmitUi } from "./submitMachine";
import { press, type PressDeps } from "./submitPress";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const FINGERPRINT = "d".repeat(64);
const KEYS = ["0190a000-0000-7000-8000-000000000001", "0190a000-0000-7000-8000-000000000002", "0190a000-0000-7000-8000-000000000003"];

type AttemptState = "running" | "committed" | "failed";

/** A server that has what the real one has: attempts by key, the first result for a key, and the entry's state. */
function server() {
  const attempts = new Map<string, { kind: "submit" | "retranslate"; state: AttemptState; outcome: string | null }>();
  let latest: string | null = null;
  let status: EntryState["entry"]["status"] = "draft";
  const stateBody = (): EntryState => {
    const attempt = latest === null ? null : attempts.get(latest)!;
    return {
      v: 1,
      server_now: "2026-10-04T14:00:00.000Z",
      entry: { id: ENTRY, alert_id: ALERT, kind: "ack", status, version: status === "pending_approval" ? 1 : 0, content_hash: status === "pending_approval" ? "e".repeat(64) : null, possible_duplicate_of: null },
      attempt:
        latest === null || attempt === null
          ? null
          : { key: latest, kind: attempt.kind, state: attempt.state, outcome: attempt.outcome, started_at: "2026-10-04T13:59:10.000Z", finished_at: attempt.state === "running" ? null : "2026-10-04T13:59:20.000Z", budget_ms: 35000, progress: {}, result_version: attempt.state === "committed" ? 1 : null },
      translations: [],
    };
  };
  const result = (stateName: SubmitResult["state"], outcome: string | null = null): SubmitResult => ({ v: 1, state: stateName, outcome, entry_state: stateBody() });
  return {
    attempts,
    /** The server receives the request: it runs it (to `end`) or returns the first result for the key. */
    receive(request: SubmitRequest, end: AttemptState = "committed"): SubmitResult {
      const known = attempts.get(request.key);
      if (known) return result(known.state);
      if (status !== "draft") return result("refused", "ILLEGAL_TRANSITION");
      if ([...attempts.values()].some((attempt) => attempt.state === "running")) return result("refused", "SUBMIT_IN_PROGRESS");
      attempts.set(request.key, { kind: "submit", state: end, outcome: end === "failed" ? "ROUTES_UNAVAILABLE" : null });
      latest = request.key;
      if (end === "committed") status = "pending_approval";
      return result(end);
    },
    /** A running attempt ends (its function finishes). */
    finish(key: string, end: "committed" | "failed") {
      const attempt = attempts.get(key)!;
      attempts.set(key, { ...attempt, state: end, outcome: end === "failed" ? "ROUTES_UNAVAILABLE" : null });
      if (end === "committed") status = "pending_approval";
    },
    state: stateBody,
    isDraft: () => status === "draft",
  };
}

interface Harness {
  deps: PressDeps;
  events: SubmitEvent[];
  ui: () => SubmitUi;
  submits: SubmitRequest[];
  saves: { count: number };
  shown: ComposeState[];
  drive: (kind?: "submit" | "retranslate") => Promise<void>;
}

/**
 * The press with its seams faked: `onSubmit` is what the network does with a submit request (answer it, or throw as a dropped connection
 * does), `saveAnswer` what the save says, and `serverState` what asking for the entry's state returns.
 */
function harness(options: {
  onSubmit: (request: SubmitRequest) => SubmitResult | Promise<SubmitResult>;
  serverState: () => EntryState | null;
  saveAnswer?: () => ComposeState;
  start?: SubmitUi;
}): Harness {
  let ui = options.start ?? initialSubmitUi(null);
  const events: SubmitEvent[] = [];
  const submits: SubmitRequest[] = [];
  const saves = { count: 0 };
  const shown: ComposeState[] = [];
  let next = 0;
  const api: SubmitApi = {
    submit: async (request) => {
      submits.push(request);
      return options.onSubmit(request);
    },
    retranslate: async (request) => {
      submits.push(request);
      return options.onSubmit(request);
    },
    state: async () => options.serverState(),
  };
  const deps: PressDeps = {
    alertId: ALERT,
    entryId: ENTRY,
    api,
    save: async () => {
      saves.count += 1;
      return options.saveAnswer ? options.saveAnswer() : { status: "saved", location: "/x", fingerprint: FINGERPRINT };
    },
    saveFailed: { status: "refused", message: "That could not be done." },
    showSave: (state) => shown.push(state),
    seen: () => ({ version: 1, hash: "e".repeat(64) }),
    dispatch: (event) => {
      events.push(event);
      ui = submitReducer(ui, event);
    },
    newKey: () => KEYS[next++]!,
    now: () => 0,
  };
  return { deps, events, ui: () => ui, submits, saves, shown, drive: (kind = "submit") => press(deps, unconfirmedOf(ui), kind) };
}

describe("a press of Submit", () => {
  it("saves the draft, sends a new key with the saved draft's fingerprint, and ends on the server's answer", async () => {
    const remote = server();
    const h = harness({ onSubmit: (request) => remote.receive(request), serverState: () => remote.state() });

    await h.drive();

    expect(h.saves.count).toBe(1);
    expect(h.submits).toEqual([{ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEYS[0], draft: FINGERPRINT }]);
    expect(h.events.map((event) => event.type)).toEqual(["saving", "sent", "answered"]);
    expect(h.ui()).toEqual({ phase: "ended", outcome: "committed" });
    expect(h.shown).toEqual([{ status: "idle" }]);
  });

  it("stops at the form when the save is refused or asks about the clock change: nothing is sent, and no key is made", async () => {
    for (const refusal of [{ status: "refused", message: "The text is too long." }, { status: "ask", question: "q", before: "b", after: "a" }] as ComposeState[]) {
      const h = harness({ onSubmit: () => { throw new Error("must not be sent"); }, serverState: () => null, saveAnswer: () => refusal });

      await h.drive();

      expect(h.submits).toEqual([]);
      expect(h.shown).toEqual([refusal]);
      expect(h.ui()).toEqual({ phase: "idle", message: null, unconfirmed: null });
    }
  });

  it("says the draft could not be saved when the save itself throws", async () => {
    const h = harness({ onSubmit: () => { throw new Error("must not be sent"); }, serverState: () => null });
    h.deps.save = async () => {
      throw new Error("network");
    };

    await h.drive();

    expect(h.shown).toEqual([{ status: "refused", message: "That could not be done." }]);
    expect(h.submits).toEqual([]);
  });

  it("goes back to the form with the refusal's code when the server refuses before anything started", async () => {
    const remote = server();
    remote.attempts.set("0190a000-0000-7000-8000-0000000000ff", { kind: "submit", state: "committed", outcome: null });
    const h = harness({ onSubmit: () => ({ v: 1, state: "refused", outcome: "DRAFT_CHANGED", entry_state: remote.state() }), serverState: () => remote.state() });

    await h.drive();

    expect(h.ui()).toEqual({ phase: "idle", message: "DRAFT_CHANGED", unconfirmed: null });
  });
});

describe("a lost answer, and the key that is kept", () => {
  it("keeps the same key when the connection drops: the next press sends it again, and never makes a second version", async () => {
    const remote = server();
    let arrived: Promise<SubmitResult> | null = null;
    let connection: "dropped" | "up" = "dropped";
    const h = harness({
      // The first request reaches the server (it will run to its end) but its answer is lost; the second goes through.
      onSubmit: (request) => {
        if (connection === "dropped") {
          arrived = Promise.resolve(remote.receive(request, "running"));
          throw new TypeError("Failed to fetch");
        }
        return remote.receive(request);
      },
      serverState: () => remote.state(),
    });

    await h.drive();
    expect(h.ui()).toMatchObject({ phase: "running", lost: true, key: KEYS[0] });
    await arrived;

    // The screen polls, finds nothing it can follow within its window (say the state could not be read), and says it could not confirm.
    const gaveUp = submitReducer(h.ui(), { type: "polled", state: null, at: UNCONFIRMED_WINDOW_MS });
    expect(gaveUp).toEqual({ phase: "idle", message: "NOT_REACHED", unconfirmed: { key: KEYS[0], kind: "submit" } });

    // The attempt, meanwhile, ended on the server. The next press asks the server what became of the key, and follows it, sending nothing.
    remote.finish(KEYS[0]!, "committed");
    connection = "up";
    const again = harness({ onSubmit: (request) => remote.receive(request), serverState: () => remote.state(), start: gaveUp });
    await again.drive();

    expect(again.submits).toEqual([]);
    expect(again.saves.count).toBe(0);
    expect(again.ui()).toEqual({ phase: "ended", outcome: "committed" });
    expect([...remote.attempts.keys()]).toEqual([KEYS[0]]);
  });

  it("sends the same key again when the server never saw it: the press is run for that key, once", async () => {
    const remote = server();
    const unconfirmed = { key: KEYS[0]!, kind: "submit" as const };
    const h = harness({ onSubmit: (request) => remote.receive(request), serverState: () => remote.state(), start: { phase: "idle", message: "NOT_REACHED", unconfirmed } });

    await h.drive();

    // It asked first (the server knew nothing of the key), then saved, then sent the SAME key, not a new one.
    expect(h.events.map((event) => event.type)).toEqual(["saving", "sent", "answered"]);
    expect(h.submits.map((request) => request.key)).toEqual([KEYS[0]]);
    expect(h.saves.count).toBe(1);
    expect(h.ui()).toEqual({ phase: "ended", outcome: "committed" });
    expect([...remote.attempts.keys()]).toEqual([KEYS[0]]);
  });

  it("follows an attempt the server knows by the key, without saving or sending: the key is confirmed by the server's own state", async () => {
    for (const end of ["running", "committed", "failed"] as const) {
      const remote = server();
      remote.receive({ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEYS[0]! }, end);
      const h = harness({
        onSubmit: () => {
          throw new Error("must not be sent");
        },
        serverState: () => remote.state(),
        start: { phase: "idle", message: "NOT_REACHED", unconfirmed: { key: KEYS[0]!, kind: "submit" } },
      });

      await h.drive();

      expect(h.saves.count, end).toBe(0);
      expect(h.submits, end).toEqual([]);
      expect(h.events.map((event) => event.type), end).toEqual(["saving", "known"]);
      if (end === "running") expect(h.ui()).toMatchObject({ phase: "running", key: KEYS[0], awaiting: "state", lost: false });
      else expect(h.ui()).toEqual({ phase: "ended", outcome: end });
    }
  });

  it("asks again when the save is refused with a key unconfirmed: the earlier request may have frozen the entry in between", async () => {
    const remote = server();
    const unconfirmed = { key: KEYS[0]!, kind: "submit" as const };
    // The server does not know the key when first asked; by the time the save is refused (the entry is no longer a draft) it does.
    let asked = 0;
    const h = harness({
      onSubmit: () => {
        throw new Error("must not be sent");
      },
      serverState: () => {
        asked += 1;
        if (asked === 2) remote.receive({ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEYS[0]! });
        return remote.state();
      },
      saveAnswer: () => ({ status: "refused", message: "This alert is not a draft, so it cannot be changed or submitted." }),
      start: { phase: "idle", message: "NOT_REACHED", unconfirmed },
    });

    await h.drive();

    expect(asked).toBe(2);
    expect(h.submits).toEqual([]);
    expect(h.shown).toEqual([]);
    expect(h.ui()).toEqual({ phase: "ended", outcome: "committed" });
  });

  it("shows the save's refusal when the server does not know the key either (the save was refused for its own reason)", async () => {
    const remote = server();
    const refusal: ComposeState = { status: "refused", message: "The text is too long." };
    const h = harness({
      onSubmit: () => {
        throw new Error("must not be sent");
      },
      serverState: () => remote.state(),
      saveAnswer: () => refusal,
      start: { phase: "idle", message: "NOT_REACHED", unconfirmed: { key: KEYS[0]!, kind: "submit" } },
    });

    await h.drive();

    expect(h.shown).toEqual([refusal]);
    // The key is still unconfirmed for the next press.
    expect(h.ui()).toEqual({ phase: "idle", message: null, unconfirmed: { key: KEYS[0], kind: "submit" } });
  });

  it("sends the key again when the server cannot be asked either: the same key, never a new one", async () => {
    const remote = server();
    const h = harness({ onSubmit: (request) => remote.receive(request), serverState: () => null, start: { phase: "idle", message: "NOT_REACHED", unconfirmed: { key: KEYS[0]!, kind: "submit" } } });

    await h.drive();

    expect(h.submits.map((request) => request.key)).toEqual([KEYS[0]]);
  });

  it("makes a new key when the outcome of the last is known: after a refusal, after a failure the server reported", async () => {
    const remote = server();
    // A first press that the server answered (failed): confirmed.
    const first = harness({ onSubmit: (request) => remote.receive(request, "failed"), serverState: () => remote.state() });
    await first.drive();
    expect(first.ui()).toEqual({ phase: "ended", outcome: "failed" });
    expect(unconfirmedOf(first.ui())).toBeNull();

    // The page loads again; the next press has no earlier key, so a new key goes out.
    const second = harness({ onSubmit: (request) => remote.receive(request), serverState: () => remote.state() });
    second.deps.newKey = () => KEYS[1]!;
    await second.drive();
    expect(second.submits.map((request) => request.key)).toEqual([KEYS[1]]);
  });

  it("does not send an earlier key of another kind: a press of Try translation again makes its own", async () => {
    const remote = server();
    const h = harness({
      onSubmit: (request) => remote.receive(request),
      serverState: () => remote.state(),
      start: { phase: "idle", message: "NOT_REACHED", unconfirmed: { key: KEYS[0]!, kind: "submit" } },
    });

    h.deps.newKey = () => KEYS[1]!;
    await h.drive("retranslate");

    expect(h.submits).toHaveLength(1);
    expect(h.submits[0]).toMatchObject({ key: KEYS[1], seen_version: 1 });
    expect(h.saves.count).toBe(0);
  });
});

describe("a press that finds another attempt running", () => {
  it("follows it to its end instead of showing an error: the page loads when it ends", async () => {
    const remote = server();
    remote.receive({ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEYS[2]! }, "running");
    const h = harness({ onSubmit: (request) => remote.receive(request), serverState: () => remote.state() });

    await h.drive();

    expect(h.ui()).toMatchObject({ phase: "running", key: KEYS[2], own: false, awaiting: "state" });
    expect(unconfirmedOf(h.ui())).toBeNull();
    remote.finish(KEYS[2]!, "committed");
    expect(submitReducer(h.ui(), { type: "polled", state: remote.state(), at: 1000 })).toEqual({ phase: "ended", outcome: "committed" });
  });
});

describe("Try translation again", () => {
  it("sends the version and hash the person saw, with no save, under a new key", async () => {
    const remote = server();
    const h = harness({ onSubmit: (request) => remote.receive(request), serverState: () => remote.state() });

    await h.drive("retranslate");

    expect(h.saves.count).toBe(0);
    expect(h.submits).toEqual([{ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEYS[0], seen_version: 1, seen_hash: "e".repeat(64) }]);
  });
});
