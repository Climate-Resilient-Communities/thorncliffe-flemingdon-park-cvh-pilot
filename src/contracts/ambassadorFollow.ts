// The wire contract of an ambassador following up on what they posted (S08.04, A-03; AD-20): correcting or withdrawing their own pending post, and "Mark resolved"
// (the final message of an alert about their building). Each is one request that makes the draft and submits it, like a post (src/contracts/ambassadorPost.ts):
// E04's submit (the browser's idempotency key, translation, rendering, frozen content) and then a second person's approval. Nothing here closes a thread or
// replaces an entry by itself: only the Hub's approval does (E05). The answer is the submit's own body (`SubmitResultSchema`).
//
// The page makes the new entry's id and the key when it draws the form and keeps them for the press, so a request sent again (a lost answer, or one held until
// signal came back) makes one draft and one pending version. Pure and browser-safe: it imports only zod and the shared schemas.
import { z } from "zod";
import { SUBMIT_KEY_PATTERN } from "./alertSubmit";
import { ALERT_TEXT_MAX } from "./alertContent";
import { PostValidSchema } from "./ambassadorPost";

/** The route the A-03 forms post to. */
export const AMBASSADOR_FOLLOW_ROUTE = "/api/staff/ambassador/follow";

const Base = {
  v: z.literal(1),
  /** The thread the request is about. */
  alert_id: z.uuid(),
  /** The new entry's id, made by the page. */
  entry_id: z.uuid(),
  key: z.string().regex(SUBMIT_KEY_PATTERN),
};

/** The words of the entry; the server judges their length (at most ALERT_TEXT_MAX characters) and whether they are blank. */
const Text = z.string().max(ALERT_TEXT_MAX * 4);

export const AmbassadorFollowRequestSchema = z.discriminatedUnion("action", [
  /** Correct their own post that residents already read: the corrected words, where things stand and until when. `target` is the post. */
  z.strictObject({ ...Base, action: z.literal("correct"), target: z.uuid(), phase: z.enum(["problem", "in_progress"]), valid: PostValidSchema, text: Text }),
  /** Withdraw it: a reason from the catalog (`WITHDRAWAL_REASONS`; the use case refuses any other) and the words residents read in its place, which are the catalog's for the reason plus any the ambassador adds. */
  z.strictObject({ ...Base, action: z.literal("withdraw"), target: z.uuid(), reason: z.string().regex(/^[a-z_]{3,30}$/), text: Text }),
  /** "Mark resolved": the final message of the alert. */
  z.strictObject({ ...Base, action: z.literal("resolve"), text: Text }),
]);
export type AmbassadorFollowRequest = z.infer<typeof AmbassadorFollowRequestSchema>;
