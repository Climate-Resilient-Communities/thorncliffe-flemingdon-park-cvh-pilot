// The wire contract of "My round" (S08.07, A-04; AD-1, AD-12, AD-20; E08 definitions "Round", "Marks", "Late mark"): what the round page asks for, what
// it is answered, and the marks it sends. The page is the one exception AD-1 allows on the staff surface: once loaded, the round lives only in that page's
// memory (never the service worker, never a storage API), and marks made without signal wait there, in order, until signal returns.
//
// The round is read with a POST and answered no-store, like every personalised check-in response: a request on a floor the person covers is its
// `round_ref`, the phone number, the floor and the method (call or text), never a name, a reason or a row id; any other floor is counts only. A mark names
// the row by its `round_ref` alone and carries an id the page makes when the ambassador taps, so a mark sent again is applied once. Pure and browser-safe.
import { z } from "zod";

export { MARK_ROUTE, ROUND_PAGE, ROUND_ROUTE } from "./roundPaths";

/** A mark (E08 "Marks"): done, not reached, needs help. A later mark on the same row replaces the earlier one. */
export const MARK_STATUSES = ["done", "not_reached", "needs_help"] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];
/** A row's state as the page shows it: not marked yet, or its latest mark. */
export type RowStatus = "pending" | MarkStatus;

/** A random UUID (version 4), as the database makes `round_ref` (S08.05's check). */
export const RoundRefSchema = z.uuid({ version: "v4" });

/** The body of a round's read: nothing but the version (the person is the session; their floors are their assignments now). */
export const RoundRequestSchema = z.strictObject({ v: z.literal(1) });

/**
 * One request on a floor the person may see: its name in the round, the number in E.164, the method, its latest mark and (UAT note 9) the language the
 * resident chose, in the staff surface's words ("Urdu"), so they are called or texted in it.
 */
export const RoundContactSchema = z.strictObject({
  round_ref: RoundRefSchema,
  phone: z.string().regex(/^\+1[2-9][0-9]{9}$/),
  method: z.enum(["call", "text"]),
  status: z.enum(["pending", ...MARK_STATUSES]),
  language: z.string().min(1).max(80).optional(),
});
export type RoundContact = z.infer<typeof RoundContactSchema>;

/** How many requests a floor has, by latest mark (a floor seen as counts only). */
export const RoundCountsSchema = z.strictObject({
  pending: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  not_reached: z.number().int().nonnegative(),
  needs_help: z.number().int().nonnegative(),
});
export type RoundCounts = z.infer<typeof RoundCountsSchema>;

/** A floor of the round: its requests (a floor the person covers, or an Admin), or its counts only. */
export const RoundFloorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("contacts"), label: z.string(), requests: z.array(RoundContactSchema) }),
  z.strictObject({ kind: z.literal("counts"), label: z.string(), counts: RoundCountsSchema }),
]);
export type RoundFloor = z.infer<typeof RoundFloorSchema>;

/** One open round (one thread): what residents read about it, and its floors by building, in the buildings' and floors' own order. */
export const RoundThreadSchema = z.strictObject({
  headline: z.string(),
  buildings: z.array(z.strictObject({ address: z.string(), floors: z.array(RoundFloorSchema) })),
});
export type RoundThreadView = z.infer<typeof RoundThreadSchema>;

/** The answer to a round's read: every open round the person may see (none: no round right now). */
export const RoundResponseSchema = z.strictObject({ rounds: z.array(RoundThreadSchema) });
export type RoundResponse = z.infer<typeof RoundResponseSchema>;

/** A mark as the page sends it: the id it made when the ambassador tapped, the row's `round_ref` and the mark. */
export const MarkRequestSchema = z.strictObject({
  v: z.literal(1),
  mark_id: z.uuid(),
  round_ref: RoundRefSchema,
  status: z.enum(MARK_STATUSES),
});
export type MarkRequest = z.infer<typeof MarkRequestSchema>;

/**
 * How a mark was taken (200):
 *  - `marked`: the row's latest mark is now this one;
 *  - `already`: this mark id was applied before (sent again after a lost answer): nothing changed;
 *  - `hub_told`: a late `not_reached` or `needs_help` on a request that has ended (an unexpired stub): the Hub has been told, once per status;
 *  - `request_ended`: a late `done` on a request that has ended: nothing changed.
 * A mark on a round that has ended (a stub older than 2 hours, or purged), an unknown `round_ref` or a floor the person does not cover now is refused
 * (403, the guard's `forbidden`), and the page says the round has ended and gives the Hub's number.
 */
export const MARK_OUTCOMES = ["marked", "already", "hub_told", "request_ended"] as const;
export type MarkOutcome = (typeof MARK_OUTCOMES)[number];
export const MarkResultSchema = z.strictObject({ outcome: z.enum(MARK_OUTCOMES) });
export type MarkResult = z.infer<typeof MarkResultSchema>;
