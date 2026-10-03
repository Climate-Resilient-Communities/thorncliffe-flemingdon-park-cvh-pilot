// What the composer's browser does with a press of Submit (or of "Try translation again"), as a pure state machine (S04.05): save the draft,
// make a key for this press, send it, show progress per language and, when the answer is not seen (the connection dropped, the tab was
// closed, the server errored), fetch the entry's authoritative state and go by that: committed means the pending entry, running means
// progress for the same key, failed means the draft with its text and nothing half-frozen. The component only carries out what this decides
// (submitPress.ts does the calls); every rule is here and is tested without a browser.
//
// A key is the identity of one press, and a new one is made only when the outcome of the last is known:
//  - the server answered (committed, running, failed, or refused before anything started): the outcome is known;
//  - the answer was not seen: the request may still be waiting for the thread's lock, a cold start or the database connection, so the
//    key is kept as `unconfirmed` (here, and in session storage, submitStore.ts) and the next press sends the SAME key. The server returns
//    the first attempt's result for a key it has seen (running, committed or failed) and runs the press for one it has not, so a press
//    can never freeze two versions. Only after the whole life an attempt can have (`ATTEMPT_STALE_MS`, after which the server itself
//    reads a running attempt as abandoned) without a sign of the key is it said that the request did not arrive.
import { ATTEMPT_STALE_MS, type EntryState, type SubmitResult } from "@/contracts/alertSubmit";

/** How long, from the moment the answer was lost, the state may show no sign of the key before the screen says it could not be confirmed. */
export const UNCONFIRMED_WINDOW_MS = ATTEMPT_STALE_MS;

export type SubmitKind = "submit" | "retranslate";

/** A key whose outcome the server never confirmed: the next press of the same kind sends it again. */
export interface Unconfirmed {
  key: string;
  kind: SubmitKind;
}

export type SubmitUi =
  | { phase: "idle"; message: string | null; unconfirmed: Unconfirmed | null }
  /** The draft is being saved (and an earlier unconfirmed key asked about) before the submit is sent. */
  | { phase: "saving"; unconfirmed: Unconfirmed | null }
  | {
      phase: "running";
      key: string;
      kind: SubmitKind;
      budgetMs: number | null;
      /** Each language's result so far. */
      progress: Readonly<Record<string, string>>;
      /** Whether a request is still waiting for its answer (`answer`), or the state fetched every second is all there is to go by (`state`). */
      awaiting: "answer" | "state";
      /** The answer to the press was not seen: the screen says it is checking. */
      lost: boolean;
      /** Whether this press made the key (an attempt the screen only follows, another press's, is not the screen's to send again). */
      own: boolean;
      /** The last time there was a sign of life while only the state is watched (the attempt seen, or the moment watching began); null before. */
      since: number | null;
    }
  /** The attempt ended and froze the entry (or failed): the page is loaded again, so what it shows is what the server stores. */
  | { phase: "ended"; outcome: "committed" | "failed" };

/** Times are the caller's monotonic milliseconds (`performance.now()`), so the machine reads no clock. */
export type SubmitEvent =
  | { type: "saving" }
  /** The draft could not be saved (the form shows why). */
  | { type: "save_stopped" }
  /** A key kept from before the page was loaded (session storage). */
  | { type: "remembered"; unconfirmed: Unconfirmed }
  | { type: "sent"; key: string; kind: SubmitKind }
  /** The server already knows this key (asked before sending it again): go by the state it gave. */
  | { type: "known"; key: string; kind: SubmitKind; state: EntryState; at: number }
  | { type: "answered"; result: SubmitResult; at: number }
  | { type: "lost"; at: number }
  | { type: "polled"; state: EntryState | null; at: number };

/** Where the page starts: nothing running, or an attempt the server says is still running (the person came back to the entry). */
export function initialSubmitUi(
  resume: { key: string; kind: SubmitKind; budgetMs: number | null; progress: Readonly<Record<string, string>> } | null,
  remembered: Unconfirmed | null = null,
): SubmitUi {
  return resume === null
    ? { phase: "idle", message: null, unconfirmed: remembered }
    : { phase: "running", ...resume, awaiting: "state", lost: false, own: false, since: null };
}

const running = (ui: SubmitUi): Extract<SubmitUi, { phase: "running" }> | null => (ui.phase === "running" ? ui : null);

/** The key whose outcome is not known, if there is one: it is what the next press sends again. */
export function unconfirmedOf(ui: SubmitUi): Unconfirmed | null {
  if (ui.phase === "idle" || ui.phase === "saving") return ui.unconfirmed;
  // A key this press made is unconfirmed until the server's own answer (or its state) shows it.
  if (ui.phase === "running" && ui.own && (ui.awaiting === "answer" || ui.lost)) return { key: ui.key, kind: ui.kind };
  return null;
}

export function submitReducer(ui: SubmitUi, event: SubmitEvent): SubmitUi {
  switch (event.type) {
    case "saving":
      return { phase: "saving", unconfirmed: ui.phase === "idle" || ui.phase === "saving" ? ui.unconfirmed : null };
    case "save_stopped":
      return { phase: "idle", message: null, unconfirmed: ui.phase === "saving" ? ui.unconfirmed : null };
    case "remembered":
      return ui.phase === "idle" && ui.unconfirmed === null ? { ...ui, unconfirmed: event.unconfirmed } : ui;
    case "sent":
      return { phase: "running", key: event.key, kind: event.kind, budgetMs: null, progress: {}, awaiting: "answer", lost: false, own: true, since: null };
    case "known":
      return submitReducer(
        { phase: "running", key: event.key, kind: event.kind, budgetMs: null, progress: {}, awaiting: "state", lost: false, own: true, since: event.at },
        { type: "polled", state: event.state, at: event.at },
      );
    case "lost": {
      const current = running(ui);
      return current ? { ...current, awaiting: "state", lost: true, since: current.since ?? event.at } : ui;
    }
    case "answered": {
      const current = running(ui);
      if (!current) return ui;
      const { result } = event;
      const attempt = result.entry_state?.attempt ?? null;
      if (result.state === "refused") {
        // Another attempt is running for this entry (this press's key was never used): follow that one, so the page loads when it ends.
        if (result.outcome === "SUBMIT_IN_PROGRESS" && attempt?.state === "running") {
          return { phase: "running", key: attempt.key, kind: attempt.kind, budgetMs: attempt.budget_ms, progress: attempt.progress, awaiting: "state", lost: false, own: false, since: event.at };
        }
        // Nothing was started (the draft cannot be submitted): the entry is as it was, the outcome is known, and the person is told why.
        return { phase: "idle", message: result.outcome, unconfirmed: null };
      }
      if (result.state === "committed") return { phase: "ended", outcome: "committed" };
      if (result.state === "failed") return { phase: "ended", outcome: "failed" };
      // Still running (this key was already running: the first attempt's state): progress for that key, by the state from here on.
      if (attempt && attempt.key === current.key) {
        return { ...current, budgetMs: attempt.budget_ms, progress: attempt.progress, awaiting: "state", lost: false, since: event.at };
      }
      return { ...current, awaiting: "state", since: current.since ?? event.at };
    }
    case "polled": {
      const current = running(ui);
      if (!current) return ui;
      const attempt = event.state?.attempt ?? null;
      if (attempt && attempt.key === current.key) {
        if (attempt.state === "committed") return { phase: "ended", outcome: "committed" };
        if (attempt.state === "failed") return { phase: "ended", outcome: "failed" };
        return { ...current, budgetMs: attempt.budget_ms, progress: attempt.progress, lost: false, since: event.at };
      }
      // No attempt for this key (yet). While a request is waiting for its answer, its own answer comes. Otherwise the request may still be
      // on its way (a cold start, the thread's lock, the connection), so only after the whole life an attempt can have without a sign of
      // it is it said that it could not be confirmed, and the key is kept for the next press.
      if (current.awaiting === "answer") return current;
      const since = current.since ?? event.at;
      if (event.at - since >= UNCONFIRMED_WINDOW_MS) return { phase: "idle", message: "NOT_REACHED", unconfirmed: current.own ? { key: current.key, kind: current.kind } : null };
      return { ...current, since };
    }
  }
}

/** How many of the languages have settled. */
export const doneCount = (progress: Readonly<Record<string, string>>): number => Object.keys(progress).length;
