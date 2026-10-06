// The inbound router's rules (S07.04, AD-9, E07 definitions "Reply normalisation", "Decision table", "Reply 0"). Pure: no I/O, no clock.
//
// An inbound text is read once into a keyword and then forgotten (the body is never stored, only the day's count of its keyword). The
// keyword, with the number's state (`none`, `pending` or `active`) and the subscriber's open prompt, chooses one action from the decision
// table below; `application/inbound.ts` carries it out.
//
// The keywords residents text (YES, STOP, START) stay in English in every language; YES is also accepted as the catalog's word for yes in the
// number's language (`smsKeywords.yes`). Digits are read in any script (`toAsciiDigits`: Urdu's ۰, Bengali's ০, Gujarati's ૦, full-width ０...).
import { toAsciiDigits } from "../../../contracts/digits";

/** What an inbound text can mean. Everything else is `other`. These are also the only things counted (`inbound_keyword_count`). */
export const INBOUND_KEYWORDS = ["stop", "start", "help", "yes", "0", "1", "2", "3", "other"] as const;
export type InboundKeyword = (typeof INBOUND_KEYWORDS)[number];

/**
 * Twilio's opt-out keywords (Advanced Opt-Out's defaults), for a message that arrives without `OptOutType`: Twilio's own handling is the
 * rule, and a STOP it did not mark is still a request to be deleted, never a text to answer.
 */
export const STOP_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"] as const;
const START_WORDS = ["start", "unstop"] as const;
const HELP_WORDS = ["help", "info"] as const;

/** YES in English: `YES` or `Y`, in any case. */
export const ENGLISH_YES = ["yes", "y"] as const;

/** The invisible direction marks a right-to-left keyboard can put around what is typed (as in src/contracts/signup.ts). */
const DIRECTION_MARKS = /[​-‏؜‪-‮⁦-⁩﻿]/g;
/** Punctuation, symbols (an emoji, a full stop, "!") and spaces around a reply: "Yes!" and " 0." are YES and 0. */
const EDGES = /^[\p{P}\p{S}\p{Z}\s]+|[\p{P}\p{S}\p{Z}\s]+$/gu;

/**
 * The text as the router compares it: Unicode NFKC (full-width letters and digits to their plain forms), digits in any script as 0-9, no
 * direction marks, trimmed of spaces, punctuation and symbols at either end, inner spaces collapsed, and case-folded.
 */
export function normaliseReply(body: string): string {
  return toAsciiDigits(body.normalize("NFKC"))
    .replace(DIRECTION_MARKS, "")
    .replace(EDGES, "")
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

/** The accepted words for yes from a catalog string: a comma-separated list, each normalised as a reply is ("sí, si" is two). */
export function yesWordsOf(catalogValue: string): string[] {
  return catalogValue
    .split(/[,،、，]/u)
    .map(normaliseReply)
    .filter((word) => word !== "");
}

/**
 * The keyword of an inbound message. `OptOutType` (set by Twilio's Advanced Opt-Out on STOP, START and HELP) decides first: Twilio has
 * handled the message and replied. Otherwise the normalised body: one of the opt-out words, YES (English, or `yesWords`, the words of the
 * number's language), a single digit 0 to 3, or `other`.
 */
export function readKeyword(input: { body: string; optOutType: string | null; yesWords?: readonly string[] }): InboundKeyword {
  const optOut = input.optOutType?.trim().toUpperCase();
  if (optOut === "STOP") return "stop";
  if (optOut === "START") return "start";
  if (optOut === "HELP") return "help";
  const text = normaliseReply(input.body);
  if ((STOP_WORDS as readonly string[]).includes(text)) return "stop";
  if ((START_WORDS as readonly string[]).includes(text)) return "start";
  if ((HELP_WORDS as readonly string[]).includes(text)) return "help";
  if ((ENGLISH_YES as readonly string[]).includes(text) || (input.yesWords ?? []).includes(text)) return "yes";
  if (text === "0" || text === "1" || text === "2" || text === "3") return text;
  return "other";
}

/**
 * The prompt a subscriber can have open. An expired prompt is no prompt. S07.04: the deletion's confirmation. S07.05 (domain/menus.ts,
 * `openPromptOf`): a menu (`menu`), a menu whose last message is 10 minutes old (`menu_idle`: it has reset), and the edit link's offer at
 * the daily menu limit (`edit_link_offer`, once S07.06 sends the link).
 */
export type OpenPrompt = "none" | "delete_confirm" | "menu" | "menu_idle" | "edit_link_offer";

/**
 * The number's state, as the router reads it under the number's lock. A pending sign-up past its `expires_at` is `none` (S07.02 handoff).
 * S09.07: an `active` state carries `reconsent` while the subscriber is asked to re-consent and the campaign's deadline has not passed (their re-consent
 * prompt is open, though a later prompt, an S07.05 menu or the deletion's confirmation, may hold its row); `lapsed` is a subscriber who was asked and did
 * not reply by the deadline (they receive nothing, no menu either, until S09.08's purge deletes them).
 */
export type NumberState = { kind: "none" } | { kind: "pending" } | { kind: "active"; prompt: OpenPrompt; reconsent?: true } | { kind: "lapsed" };

/**
 * What the router does (E07 "Decision table"):
 *  - `reconsent` (S09.07): YES resolves to the re-consent prompt: the subscriber stays (`retained`) and is told so;
 *  - `pilot_ended` (S09.07): YES after the deadline: "The CVH pilot has ended; your number was not kept", through `inbound_reply`;
 *  - `delete`: delete everything held for the number, and send nothing (STOP; the second 0);
 *  - `none`: change nothing and send nothing;
 *  - `confirm`: the pending sign-up becomes a subscriber, and the welcome text is queued;
 *  - `already_signed_up`: "You are already signed up";
 *  - `ask_delete`: open the deletion's confirmation prompt and send it;
 *  - `menu`: reply 1, 2 or 3, handed to the menus (S07.05: 1 and 2 start a menu, 3 withdraws a check-in request);
 *  - `menu_reply`: a reply inside an open menu, handed to it (S07.05: 0 is Back there, not a deletion);
 *  - `edit_link`: 1 to the edit link's offer, handed to the edit link (S07.06);
 *  - `signup_info`: the sign-up link, at most once a day per number, through `inbound_reply`.
 */
export type InboundAction =
  | { kind: "reconsent" }
  | { kind: "pilot_ended" }
  | { kind: "delete" }
  | { kind: "none" }
  | { kind: "confirm" }
  | { kind: "already_signed_up" }
  | { kind: "ask_delete" }
  | { kind: "menu"; choice: "1" | "2" | "3" }
  | { kind: "menu_reply" }
  | { kind: "edit_link" }
  | { kind: "signup_info" };

export interface Decision {
  action: InboundAction;
  /** True when the subscriber's open prompt is cancelled first ("any other reply cancels it"). */
  cancelPrompt: boolean;
  /** S07.05: the menu was idle for 10 minutes: the reply says it has reset, and the text is then read as a new keyword (`action`). */
  menuReset?: true;
}

const keep = (action: InboundAction): Decision => ({ action, cancelPrompt: false });

/** The decision table: one row per (keyword, state, open prompt); src/modules/subscriptions/domain/inbound.test.ts has a test for each. */
export function decide(keyword: InboundKeyword, state: NumberState): Decision {
  // Opt-out events and deletion requests come first, whatever the state (E07 "Inbound order").
  if (keyword === "stop") return keep({ kind: "delete" });
  // START and HELP are Twilio's to answer; the app sends nothing of its own.
  if (keyword === "start" || keyword === "help") return keep({ kind: "none" });

  switch (state.kind) {
    case "lapsed":
      // S09.07: asked to re-consent and past the deadline: nothing is sent to them any more but the answer to YES (through `inbound_reply`).
      return keep(keyword === "yes" ? { kind: "pilot_ended" } : { kind: "none" });
    case "none":
      // YES with no pending sign-up (or after it expired), and anything else from a number the CVH does not know: the sign-up link.
      return keep({ kind: "signup_info" });
    case "pending":
      // Only YES confirms; the confirmation text already told the resident what to do, so nothing else is answered.
      return keep(keyword === "yes" ? { kind: "confirm" } : { kind: "none" });
    case "active": {
      // S07.05: inside an open menu every reply but STOP, START and HELP is the menu's (0 is Back, a digit an option, anything else sends
      // the page again); a menu idle for 10 minutes has reset, and the reply is read as a new keyword with no prompt open; 1 asks for the
      // link the edit link's offer made, and any other reply cancels the offer as it does the deletion's confirmation.
      // S09.07 with S07.05: the open prompt written last wins (AD-9, one `sms_prompt` row per subscriber). A menu opened after the campaign
      // asked the subscriber took the row, so YES inside it is the menu's (the page is sent again) and keeps the subscriber asked; once the
      // menu has reset or closed, YES resolves to the re-consent again. A campaign started after the menu opened replaced the menu's row
      // with the re-consent prompt, so the menu is gone and the reply is read as a new keyword.
      if (state.prompt === "menu") return keep({ kind: "menu_reply" });
      if (state.prompt === "menu_idle") return { ...decide(keyword, { ...state, prompt: "none" }), cancelPrompt: true, menuReset: true };
      if (state.prompt === "edit_link_offer" && keyword === "1") return { action: { kind: "edit_link" }, cancelPrompt: true };
      const open = state.prompt !== "none";
      if (keyword === "0") return state.prompt === "delete_confirm" ? keep({ kind: "delete" }) : { action: { kind: "ask_delete" }, cancelPrompt: open };
      // S09.07: YES from a subscriber asked to re-consent, before the deadline and outside a menu, resolves to the re-consent prompt (it cancels a later
      // deletion's confirmation or edit link's offer, as any reply does).
      if (keyword === "yes" && state.reconsent) return { action: { kind: "reconsent" }, cancelPrompt: open };
      if (keyword === "yes") return { action: { kind: "already_signed_up" }, cancelPrompt: open };
      if (keyword === "1" || keyword === "2" || keyword === "3") return { action: { kind: "menu", choice: keyword }, cancelPrompt: open };
      return { action: { kind: "none" }, cancelPrompt: open };
    }
  }
}

/**
 * The inbound limit (S07.09, AD-22, E07 "Inbound order" step 4): one number may send this many messages in an hour. The next one (the 21st) and
 * every later one that day (Toronto) gets no reply, nothing is done for it, and only the day's count is kept. Deletion requests and Twilio's
 * opt-out events are decided before this limit and are never counted or limited: a number that sent too many can always STOP.
 */
/** The scope of the inbound limit's keyed hashes (`clientHash` and the `rate_limit` rows): one value for the application and the store. */
export const INBOUND_SCOPE = "inbound";

export const INBOUND_LIMIT = { perHour: 20, windowMs: 60 * 60_000 } as const;

/**
 * Whether the message is decided before the inbound limit: a deletion request (the first 0, which opens the confirmation, and the second, which
 * deletes) or an opt-out event (STOP, START, HELP). The first 0 sends one prompt reply and a second one within 10 minutes deletes the number, so
 * exempting it is bounded and a limited subscriber can still leave.
 */
export function exemptFromInboundLimit(keyword: InboundKeyword, action: InboundAction): boolean {
  return action.kind === "delete" || action.kind === "ask_delete" || keyword === "stop" || keyword === "start" || keyword === "help";
}

/** How long the deletion's confirmation stays open: "Reply 0 again within 10 minutes". */
export const DELETE_CONFIRM_MS = 10 * 60_000;

/** The webhook path Twilio's Messaging Service is configured with (the signed URL is PUBLIC_BASE_URL plus this). */
export const INBOUND_PATH = "/api/twilio/inbound";

/** A Twilio message id: `SM` (or `MM` for a picture message) and 32 hex digits. */
export function isMessageSid(value: string | null | undefined): value is string {
  return typeof value === "string" && /^(SM|MM)[0-9a-f]{32}$/i.test(value);
}
