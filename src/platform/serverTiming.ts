// Phase timing of a request, answered as a `Server-Timing` header (https://www.w3.org/TR/server-timing/). It is always on: a
// few numbers cost nothing, and they say where a slow request spent its time (the cold start of an instance, above all).
//
// Privacy (AD-3): the header holds phase names and numbers, and one flag (`cold`). The names are a fixed list and the flag a
// fixed word, so nothing a caller passes (a question, an id, an error message) can reach the header: anything else is dropped.

/** The phases a request can report. Fixed: a name outside the list is dropped, never written. */
export const TIMING_PHASES = ["boot", "limiter", "snapshot", "embed", "translate", "rank", "total"] as const;
export type TimingPhase = (typeof TIMING_PHASES)[number];

/** The flag a phase can carry: `cold`, the work came from storage (a cold instance), not from this instance's memory; `cache`, a cold instance got it from the shared data cache instead of storage. */
export type TimingFlag = "cold" | "cache";

/** Where phases are recorded; the search use case takes one so that it can report its own phases without knowing about HTTP. */
export interface PhaseTimings {
  record(phase: TimingPhase, ms: number, flag?: TimingFlag): void;
}

export interface TimingEntry {
  phase: TimingPhase;
  ms: number;
  flag?: TimingFlag;
}

/** `phase;dur=12.3` (milliseconds, one decimal) with `;desc=cold` or `;desc=cache` for the flagged ones; entries with an unknown phase or a bad number are left out. */
export function formatServerTiming(entries: readonly TimingEntry[]): string {
  const parts: string[] = [];
  for (const entry of entries) {
    if (!(TIMING_PHASES as readonly string[]).includes(entry.phase)) continue;
    if (typeof entry.ms !== "number" || !Number.isFinite(entry.ms)) continue;
    const dur = (Math.round(Math.max(0, entry.ms) * 10) / 10).toString();
    parts.push(`${entry.phase};dur=${dur}${entry.flag === "cold" || entry.flag === "cache" ? `;desc=${entry.flag}` : ""}`);
  }
  return parts.join(", ");
}

/** Records phases for one request and writes them as the header. A phase recorded twice (a retry) keeps both entries' sum under one name. */
export function createTimings(): PhaseTimings & { entries(): TimingEntry[]; header(): string } {
  const entries: TimingEntry[] = [];
  return {
    record(phase, ms, flag) {
      const found = entries.find((entry) => entry.phase === phase);
      if (found) {
        found.ms += ms;
        if (flag) found.flag = flag;
      } else entries.push({ phase, ms, ...(flag ? { flag } : {}) });
    },
    entries: () => entries.map((entry) => ({ ...entry })),
    header: () => formatServerTiming(entries),
  };
}

const evaluatedAt = performance.now();
let firstRequestSeen = false;

/**
 * The time from this module's evaluation (the instance loading the route) to the first request's start, for the first request
 * this instance serves; null for every later one. Pass the request's start on the same clock (`performance.now`).
 */
export function bootMs(requestStartedAt: number = performance.now()): number | null {
  if (firstRequestSeen) return null;
  firstRequestSeen = true;
  return Math.max(0, requestStartedAt - evaluatedAt);
}
