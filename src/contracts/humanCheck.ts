import { z } from "zod";

/**
 * The token of the human check (src/platform/humanCheck.ts) that the text sign-up and place suggestion forms send when the check is on.
 * Optional in both contracts: with the check off the forms send none, and the server asks for none. A Turnstile token is at most 2048
 * characters; anything over 4096 is refused as an unreadable request.
 */
export const HUMAN_TOKEN_MAX_CHARS = 4096;
export const HumanTokenSchema = z.string().max(HUMAN_TOKEN_MAX_CHARS).optional();

/** Where the widget's script comes from, and the one origin the CSP adds for it (script, frame, connect) while the check is on. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const TURNSTILE_SCRIPT = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;
