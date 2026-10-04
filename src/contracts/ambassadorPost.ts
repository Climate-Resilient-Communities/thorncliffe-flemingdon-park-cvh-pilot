// The wire contract of an ambassador's post (S08.02, A-02; AD-20): what the ambassador's page sends to post an update or incident for their floors, in one
// request that makes the draft and submits it (E04's submit: the browser's idempotency key, translation, rendering, frozen content, second-person approval).
// The answer is the submit's own body (`SubmitResultSchema`, src/contracts/alertSubmit.ts): an expected outcome is a 200 with a `state` and a code, never text.
//
// The page makes the thread's id, the entry's id and the key when it draws the form and keeps them for the press: a post sent again (the answer was lost, or
// the page held it until signal came back) names the same ids and key, so it makes one thread, one entry and one pending version. Nothing of it is ever
// written to the phone's storage: the page holds it in memory only. Pure and browser-safe: it imports only zod and the shared schemas.
import { z } from "zod";
import { SUBMIT_KEY_PATTERN } from "./alertSubmit";
import { FloorIdSchema, RsnSchema } from "./places";
import { ALERT_TEXT_MAX } from "./alertContent";

/** The route an ambassador's page posts to. */
export const AMBASSADOR_POST_ROUTE = "/api/staff/ambassador/posts";

/** Which floors: the whole building, a list of floors, or a range from one floor to another in the building's own order. */
export const PostFloorsSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("all") }),
  z.strictObject({ mode: z.literal("list"), ids: z.array(FloorIdSchema).min(1).max(300) }),
  z.strictObject({ mode: z.literal("range"), from: FloorIdSchema, to: FloorIdSchema }),
]);
export type PostFloors = z.infer<typeof PostFloorsSchema>;

/** Until when: "until it is fixed" (24 elapsed hours from when the server takes it), or a date and a time in Toronto. */
export const PostValidSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("resolved") }),
  z.strictObject({ mode: z.literal("at"), date: z.string().max(10), time: z.string().max(5) }),
]);
export type PostValid = z.infer<typeof PostValidSchema>;

export const AmbassadorPostRequestSchema = z.strictObject({
  v: z.literal(1),
  /** The open thread the post is an update to; null for a new thread. */
  into: z.uuid().nullable(),
  /** The new thread's id, made by the page (ignored for an update). */
  alert_id: z.uuid(),
  entry_id: z.uuid(),
  key: z.string().regex(SUBMIT_KEY_PATTERN),
  /** The one building the post is for. */
  rsn: RsnSchema,
  floors: PostFloorsSchema,
  /** What is happening (the types an Ambassador may post); an update keeps its thread's. */
  types: z.array(z.string().regex(/^[a-z][a-z_]{1,19}$/)).max(10),
  phase: z.enum(["problem", "in_progress"]),
  valid: PostValidSchema,
  /** The English text; the server judges its length (at most ALERT_TEXT_MAX characters) and whether it is blank. */
  text: z.string().max(ALERT_TEXT_MAX * 4),
});
export type AmbassadorPostRequest = z.infer<typeof AmbassadorPostRequestSchema>;

/**
 * The codes a post can be refused with before anything is submitted that are the route's own (the rest are the alerting module's refusals): a valid-until
 * that is not a date and a time, and one that the clocks skip or repeat on the night they change (the ambassador picks another time).
 */
export const POST_TIME_CODES = ["VALID_UNTIL_INVALID", "VALID_UNTIL_SKIPPED"] as const;
