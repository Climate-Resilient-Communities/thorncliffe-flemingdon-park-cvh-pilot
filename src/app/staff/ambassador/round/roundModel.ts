// "My round" as the open page holds it (S08.07, A-04; AD-1's one exception on the staff surface; E08 definitions "Marks", "Unsent post"). Browser-safe and
// pure of any page: the page gives it the browser's seams (fetch, whether there is signal, the `online` event, a timer, the id maker, the clock), so the
// tests drive it without a browser.
//
// The round is held only in this object's memory: nothing is written to the phone's storage (no localStorage, sessionStorage, IndexedDB, Cache Storage or
// cookie; the service worker never answers or keeps the page or its API). A tap is a mark with an id made at once; it is shown on its row and sent at once
// with signal. Without signal (or when a request gets no answer) the marks wait in this page's memory, in the order they were made, and are sent one at a
// time, in that order, when signal returns while the page is open (the `online` event, and a retry every 20 s in case it never comes); a mark sent again
// keeps its id, so the server applies it once.
//
// Background (the page cannot trust a timer: browsers suspend them): when the page is hidden the time is recorded; when it is visible again, or restored by
// back navigation or the browser's page cache (`pageshow`), the page compares that time with now before anything is drawn, and after 10 minutes or more it
// clears the round and every unsent mark and says "Reload your round with signal". `pagehide` clears the round's numbers at once; the unsent marks (a
// `round_ref` and a mark each, nothing about the resident) stay so that a page restored within 10 minutes still sends them, and the round is read again.
import { MARK_ROUTE, MarkResultSchema, ROUND_ROUTE, RoundResponseSchema, type MarkOutcome, type MarkStatus, type RoundResponse, type RowStatus } from "@/contracts/checkinRound";

/** How long the page may stay in the background before it clears everything (AD-1, E08). */
export const BACKGROUND_LIMIT_MS = 10 * 60 * 1000;
/** How long to wait before trying unsent marks again when no `online` event comes. */
export const UNSENT_RETRY_MS = 20_000;
/** How long one request may go without an answer before it is given up (weak signal) and the mark waits again. */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * What the page shows:
 *  - `loading`: reading the round;
 *  - `ready`: the round (none open is `ready` with no rounds);
 *  - `cleared`: nothing to show: opened without signal, cleared after 10 minutes in the background, or after `pagehide` when restored without signal
 *    ("Reload your round with signal");
 *  - `signed_out`: the session ended (401): nothing more is sent;
 *  - `failed`: the round could not be read (a refusal or a server error).
 */
export type RoundPhase = "loading" | "ready" | "cleared" | "signed_out" | "failed";

/** What a row says after the server answered a late mark, or refused one. */
export type RowNote = "hub_told" | "request_ended" | "round_ended" | "mark_failed";

/** A mark waiting to be sent: the id made at the tap, the row's `round_ref` and the mark. */
export interface QueuedMark {
  id: string;
  roundRef: string;
  status: MarkStatus;
}

export interface RoundState {
  phase: RoundPhase;
  /** The round as read, with the marks made here laid over it; null when nothing is held. */
  round: RoundResponse | null;
  /** The marks waiting to be sent, oldest first. */
  waiting: readonly QueuedMark[];
  /** Whether the browser says there is signal. */
  online: boolean;
  notes: Readonly<Record<string, RowNote>>;
}

export interface RoundEnv {
  fetch: (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
  /** `navigator.onLine`: false is "no signal for sure"; true may still fail, and a failed request is treated the same. */
  isOnline: () => boolean;
  /** Subscribes to the browser's `online` event; returns the unsubscribe. */
  onOnline: (listener: () => void) => () => void;
  /** `setTimeout`; returns the cancel. Used for retries and request timeouts, never for the background limit. */
  later: (run: () => void, ms: number) => () => void;
  /** `crypto.randomUUID()`: a mark's id. */
  newId: () => string;
  /** `Date.now()`. */
  now: () => number;
}

export interface RoundModel {
  state(): RoundState;
  /** Reads the round (on opening, and "Reload my round"); without signal the page says to reload with signal. */
  load(): void;
  /** One tap: the mark is shown on its row at once and sent, or waits for signal. Ignored unless the round is held and has that row. */
  mark(roundRef: string, status: MarkStatus): void;
  /** The page went to the background (`visibilitychange` hidden). */
  hidden(): void;
  /** The page is visible again (`visibilitychange` visible). Run before anything is drawn. */
  visible(): void;
  /** `pagehide`: the round's numbers are cleared at once. */
  pagehide(): void;
  /** `pageshow`; `persisted` when restored from the browser's page cache. Run before anything is drawn. */
  pageshow(persisted: boolean): void;
  /** The browser's `online` and `offline` events (the banner). */
  signal(online: boolean): void;
  /** Stops listening and retrying (the page is going away for good). */
  stop(): void;
}

/** The round with these statuses laid over its rows (a mark made here, newest last). */
function withStatuses(round: RoundResponse, statuses: ReadonlyMap<string, RowStatus>): RoundResponse {
  if (statuses.size === 0) return round;
  return {
    rounds: round.rounds.map((thread) => ({
      ...thread,
      buildings: thread.buildings.map((building) => ({
        ...building,
        floors: building.floors.map((floor) =>
          floor.kind === "contacts" ? { ...floor, requests: floor.requests.map((request) => ({ ...request, status: statuses.get(request.round_ref) ?? request.status })) } : floor,
        ),
      })),
    })),
  };
}

const hasRow = (round: RoundResponse, roundRef: string) =>
  round.rounds.some((thread) => thread.buildings.some((building) => building.floors.some((floor) => floor.kind === "contacts" && floor.requests.some((request) => request.round_ref === roundRef))));

export function createRoundModel(env: RoundEnv, onChange: (state: RoundState) => void, initial?: Partial<RoundState>): RoundModel {
  let phase: RoundPhase = initial?.phase ?? "loading";
  let round: RoundResponse | null = initial?.round ?? null;
  let queue: QueuedMark[] = [...(initial?.waiting ?? [])];
  let notes: Record<string, RowNote> = { ...(initial?.notes ?? {}) };
  let online = env.isOnline();
  /** When the page went to the background; null while it is in front. */
  let hiddenAt: number | null = null;
  /** Raised each time everything is cleared, so an answer to a request made before that is ignored. */
  let generation = 0;
  let sending = false;
  let loading = false;
  let stopped = false;
  let waits: (() => void)[] = [];

  /** The marks made here, by row, the newest winning: laid over the round as read, until the server's round shows them. */
  const queuedStatuses = () => new Map(queue.map((mark) => [mark.roundRef, mark.status as RowStatus]));
  const snapshot = (): RoundState => ({ phase, round: round === null ? null : withStatuses(round, queuedStatuses()), waiting: [...queue], online, notes: { ...notes } });
  const changed = () => onChange(snapshot());
  const clearWaits = () => {
    for (const cancel of waits) cancel();
    waits = [];
  };

  /** Everything goes: the round, its notes and every unsent mark ("Reload your round with signal"). */
  function clearAll() {
    generation += 1;
    clearWaits();
    round = null;
    queue = [];
    notes = {};
    sending = false;
    loading = false;
    phase = "cleared";
  }

  /** No signal, or no answer: try again when signal returns (the `online` event), or in 20 s in case it never comes. */
  function waitForSignal() {
    clearWaits();
    const retry = () => {
      clearWaits();
      void flush();
    };
    waits.push(env.onOnline(retry), env.later(retry, UNSENT_RETRY_MS));
  }

  /** A POST with a time limit: a request that gets no answer in REQUEST_TIMEOUT_MS is given up (it throws). */
  async function post(url: string, body: unknown): Promise<{ status: number; json(): Promise<unknown> }> {
    const controller = new AbortController();
    let cancel = () => {};
    try {
      const timedOut = new Promise<never>((_, reject) => {
        cancel = env.later(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, REQUEST_TIMEOUT_MS);
      });
      return await Promise.race([env.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal }), timedOut]);
    } finally {
      cancel();
    }
  }

  /** Sends the waiting marks one at a time, oldest first, until none is left or there is no signal. */
  async function flush(): Promise<void> {
    if (sending || stopped || phase === "signed_out" || queue.length === 0) return;
    if (!env.isOnline()) return waitForSignal();
    const mark = queue[0]!;
    const started = generation;
    sending = true;
    let response: { status: number; json(): Promise<unknown> };
    try {
      response = await post(MARK_ROUTE, { v: 1, mark_id: mark.id, round_ref: mark.roundRef, status: mark.status });
    } catch {
      if (started !== generation) return;
      sending = false;
      return waitForSignal();
    }
    if (started !== generation) return;
    sending = false;
    if (response.status === 401) {
      phase = "signed_out";
      clearWaits();
      return changed();
    }
    if (response.status >= 500) {
      // The server may have taken it: it waits, with its id, and goes again later.
      changed();
      return waitForSignal();
    }
    queue.shift();
    let outcome: MarkOutcome | null = null;
    if (response.status === 200) {
      const parsed = MarkResultSchema.safeParse(await response.json().catch(() => null));
      outcome = parsed.success ? parsed.data.outcome : null;
    }
    if (started !== generation) return;
    const note: RowNote | null =
      response.status === 403 ? "round_ended" : outcome === "hub_told" ? "hub_told" : outcome === "request_ended" ? "request_ended" : outcome === null ? "mark_failed" : null;
    if (note === null) delete notes[mark.roundRef];
    else notes[mark.roundRef] = note;
    // The mark is the row's now (the server's answer); the round as read gets it so that it stays shown once nothing waits.
    if (round !== null && outcome !== null && outcome !== "request_ended") round = withStatuses(round, new Map([[mark.roundRef, mark.status]]));
    changed();
    return flush();
  }

  async function load(): Promise<void> {
    if (loading || stopped) return;
    if (!env.isOnline()) {
      if (round === null) {
        phase = "cleared";
        changed();
      }
      return;
    }
    const started = generation;
    loading = true;
    if (round === null) {
      phase = "loading";
      changed();
    }
    let response: { status: number; json(): Promise<unknown> };
    try {
      response = await post(ROUND_ROUTE, { v: 1 });
    } catch {
      if (started !== generation) return;
      loading = false;
      if (round === null) phase = "cleared";
      return changed();
    }
    if (started !== generation) return;
    loading = false;
    if (response.status === 401) {
      phase = "signed_out";
      return changed();
    }
    const parsed = response.status === 200 ? RoundResponseSchema.safeParse(await response.json().catch(() => null)) : null;
    if (started !== generation) return;
    if (!parsed?.success) {
      if (round === null) phase = "failed";
      return changed();
    }
    round = parsed.data;
    phase = "ready";
    changed();
    void flush();
  }

  return {
    state: snapshot,
    load: () => void load(),
    mark(roundRef, status) {
      if (stopped || phase !== "ready" || round === null || !hasRow(round, roundRef)) return;
      queue.push({ id: env.newId(), roundRef, status });
      delete notes[roundRef];
      changed();
      void flush();
    },
    hidden() {
      hiddenAt ??= env.now();
    },
    visible() {
      const since = hiddenAt;
      hiddenAt = null;
      if (since !== null && env.now() - since >= BACKGROUND_LIMIT_MS) {
        clearAll();
        changed();
        return;
      }
      void flush();
    },
    pagehide() {
      hiddenAt ??= env.now();
      generation += 1;
      clearWaits();
      sending = false;
      loading = false;
      round = null;
      notes = {};
      phase = "cleared";
      changed();
    },
    pageshow(persisted) {
      if (!persisted) return;
      const since = hiddenAt;
      hiddenAt = null;
      if (since !== null && env.now() - since >= BACKGROUND_LIMIT_MS) {
        clearAll();
        changed();
        return;
      }
      // Restored within 10 minutes: the numbers went at pagehide; with signal the round is read again and the waiting marks go on.
      changed();
      void load();
      void flush();
    },
    signal(next) {
      online = next;
      changed();
      if (next) void flush();
    },
    stop() {
      stopped = true;
      clearWaits();
    },
  };
}
