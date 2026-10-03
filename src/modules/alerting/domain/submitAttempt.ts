// The rules of a submit attempt (epic E04 S04.05; AD-5, AD-21): the idempotency key, what an attempt's states mean to a
// browser that did not see the outcome, and the channels an entry goes out on. Pure: no clock is read, `now` is given.
//
// One press of Submit makes one attempt, named by a key the browser generates for that press:
//  - `running`: the translation and rendering are under way outside any lock; the browser shows progress for this key;
//  - `committed`: the entry was frozen and moved to `pending_approval` as `result_version`; asking again with the same
//    key returns this first result and does nothing;
//  - `failed`: nothing was frozen, the entry is still a draft with its text; asking again with the same key returns the
//    failure, and a new press makes a new key (the translations already done come back from the cache).
// Only one attempt runs per entry (a unique index). A function that dies mid-attempt leaves a `running` row: after the
// function's own time limit it is treated as failed (`SUBMIT_ABANDONED`), so the entry is never stuck.

import { SUBMIT_KEY_PATTERN } from "../../../contracts/alertSubmit";

/** The key a browser makes for one press of Submit (a UUID or any 16 to 64 letters, digits, hyphens and underscores): the wire contract's. */
export { SUBMIT_KEY_PATTERN };

export const ATTEMPT_STATES = ["running", "committed", "failed"] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

export const ATTEMPT_KINDS = ["submit", "retranslate"] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

/**
 * How long a `running` attempt may be taken to be alive: the submit function's own time limit (`maxDuration` of
 * src/app/api/staff/alerts/entries/submit/route.ts, 60 s) and a margin. After that its function is gone, whatever the row says.
 * test/submitBudget.test.ts keeps this above the function's limit.
 */
export const ATTEMPT_STALE_MS = 90_000;

export function isStaleAttempt(startedAt: Date, now: Date): boolean {
  return now.getTime() - startedAt.getTime() > ATTEMPT_STALE_MS;
}

/**
 * What an entry goes out on in this epic: text messages and the web (E06 sends the texts; until then the channel is frozen
 * and hashed with the entry so that approval binds to it). The hash covers it (AD-21).
 */
export const ENTRY_CHANNELS = ["sms", "web"] as const;
