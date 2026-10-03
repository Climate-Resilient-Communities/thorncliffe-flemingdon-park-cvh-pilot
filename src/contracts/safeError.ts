// What a safe classification of a failure looks like: a few shapes of code, never a message. The one definition of it, read by
// what makes a classification (src/platform/safeError.ts) and by what stores one (an ops event's `error`, a log line), so a
// value that is not safe cannot get to either: the event refuses it, and the classifier falls back to `unknown`.
import { z } from "zod";

/** The longest classification. */
export const SAFE_ERROR_MAX_LENGTH = 80;

// Each shape is one token, or a code and its detail with a single colon between them. No space, no second colon (so no IPv6
// address), and nothing a person typed can be longer than one word.
const SHAPES = [
  // A Postgres SQLSTATE: 42501, 57014.
  "[0-9A-Z]{5}",
  // A library's constant code: ECONNREFUSED, CONNECT_TIMEOUT, UND_ERR_CONNECT_TIMEOUT.
  "[A-Z][A-Z0-9_]{2,39}",
  // A class name: TypeError, QueryEmbedError.
  "[A-Za-z]{1,40}",
  // One of our own codes: timed_out, unknown, vectors_missing, embed_failed.
  "[a-z][a-z0-9_]{0,39}",
  // A code and what it is about: translate_failed:quota, listing_schema:providers.0.neighbourhood_ids (a schema path).
  "[a-z][a-z0-9_]{0,29}:[A-Za-z0-9_.]{1,70}",
] as const;

const SAFE_ERROR = new RegExp(`^(?:${SHAPES.join("|")})$`);
// What the shapes alone would let through: a dotted address as the detail (`schema:203.0.113.9`), or a hash as a name.
const DOTTED_QUAD = /\d+\.\d+\.\d+\.\d+/;
const HEX_RUN = /[0-9a-f]{32,}/i;

/** Whether `value` is a safe classification: one of the shapes, at most 80 characters, and no address or hash in it. */
export function isSafeError(value: unknown): value is string {
  return typeof value === "string" && value.length <= SAFE_ERROR_MAX_LENGTH && SAFE_ERROR.test(value) && !DOTTED_QUAD.test(value) && !HEX_RUN.test(value);
}

/** The schema of a classification in a stored event: it refuses anything that is not safe, with no message of its own to echo it. */
export const SafeErrorSchema = z.string().refine(isSafeError, { message: "not a safe error classification" });
