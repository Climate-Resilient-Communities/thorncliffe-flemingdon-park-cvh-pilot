// What the composer's browser does with a press of Submit (or of "Try translation again"), as a pure state machine (S04.05): save the draft,
// make a key for this press, send it, show progress per language, and, when the answer is not seen (the connection dropped, the tab was
// closed, the server errored), fetch the entry's authoritative state and go by that: committed means the pending entry, running means
// progress for the same key, failed means the draft with its text and nothing half-frozen (a new press then makes a new key). The
// component only carries out what this decides; every rule is here and is tested without a browser.
import type { EntryState, SubmitResult } from "@/contracts/alertSubmit";

/** How many polls that find no attempt for the key, after the answer was lost, make the press "never reached the server". */
export const UNSEEN_POLLS_BEFORE_GIVING_UP = 3;

export type SubmitKind = "submit" | "retranslate";

export type SubmitUi =
  | { phase: "idle"; message: string | null }
  /** The draft is being saved before the submit is sent. */
  | { phase: "saving" }
  | {
      phase: "running";
      key: string;
      kind: SubmitKind;
      budgetMs: number | null;
      /** Each language's result so far. */
      progress: Readonly<Record<string, string>>;
      /** The answer to the press was not seen: the screen says it is checking, and goes by the entry's state. */
      lost: boolean;
      /** Polls that found no attempt with this key (the request may not have reached the server). */
      unseen: number;
    }
  /** The attempt ended and froze the entry (or failed): the page is loaded again, so what it shows is what the server stores. */
  | { phase: "ended"; outcome: "committed" | "failed" };

export type SubmitEvent =
  | { type: "saving" }
  /** The draft could not be saved (the form shows why). */
  | { type: "save_stopped" }
  | { type: "sent"; key: string; kind: SubmitKind }
  | { type: "answered"; result: SubmitResult }
  | { type: "lost" }
  | { type: "polled"; state: EntryState | null };

/** Where the page starts: nothing running, or an attempt the server says is still running (the person came back to the entry). */
export function initialSubmitUi(resume: { key: string; kind: SubmitKind; budgetMs: number | null; progress: Readonly<Record<string, string>> } | null): SubmitUi {
  return resume === null ? { phase: "idle", message: null } : { phase: "running", ...resume, lost: false, unseen: 0 };
}

const running = (ui: SubmitUi): Extract<SubmitUi, { phase: "running" }> | null => (ui.phase === "running" ? ui : null);

export function submitReducer(ui: SubmitUi, event: SubmitEvent): SubmitUi {
  switch (event.type) {
    case "saving":
      return { phase: "saving" };
    case "save_stopped":
      return { phase: "idle", message: null };
    case "sent":
      return { phase: "running", key: event.key, kind: event.kind, budgetMs: null, progress: {}, lost: false, unseen: 0 };
    case "lost": {
      const current = running(ui);
      return current ? { ...current, lost: true } : ui;
    }
    case "answered": {
      const current = running(ui);
      if (!current) return ui;
      const { result } = event;
      // Nothing was started (the draft cannot be submitted): the entry is as it was, and the person is told why.
      if (result.state === "refused") return { phase: "idle", message: result.outcome };
      const attempt = result.entry_state?.attempt ?? null;
      if (result.state === "committed") return { phase: "ended", outcome: "committed" };
      if (result.state === "failed") return { phase: "ended", outcome: "failed" };
      // Still running (the same key was already running: the first attempt's state): progress for that key.
      return attempt && attempt.key === current.key ? { ...current, budgetMs: attempt.budget_ms, progress: attempt.progress, lost: false } : current;
    }
    case "polled": {
      const current = running(ui);
      if (!current) return ui;
      const attempt = event.state?.attempt ?? null;
      if (!attempt || attempt.key !== current.key) {
        // No attempt for this key (yet). After a lost answer, a few polls without one mean the request never arrived: nothing was submitted.
        const unseen = current.unseen + 1;
        if (current.lost && unseen >= UNSEEN_POLLS_BEFORE_GIVING_UP) return { phase: "idle", message: "NOT_REACHED" };
        return { ...current, unseen };
      }
      if (attempt.state === "committed") return { phase: "ended", outcome: "committed" };
      if (attempt.state === "failed") return { phase: "ended", outcome: "failed" };
      return { ...current, budgetMs: attempt.budget_ms, progress: attempt.progress, unseen: 0 };
    }
  }
}

/** How many of the languages have settled. */
export const doneCount = (progress: Readonly<Record<string, string>>): number => Object.keys(progress).length;

/** Whether the screen should be polling the entry's state: while an attempt runs, and while its answer is unseen. */
export const shouldPoll = (ui: SubmitUi): boolean => ui.phase === "running";
