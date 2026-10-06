// The text to the on-call Admins (AD-21, S06.07): messaging's renderer builds it like every other outbound text, so it is normalised and counted
// the same way. The caller (ops' health job) passes the condition and a count; the wording is in the catalog (`ops.oncall.text.*`), English only
// (the on-call Admins read English in the pilot), and carries no personal data. S08.08: the text to the on-duty Admin about a check-in escalation
// (`ops.oncall.escalation.*`), with a building's address, a floor's label and a staff link, never a resident's number.
import { englishText } from "../../../i18n/text";
import { countSms, normaliseSms, type SmsEncoding } from "./smsEncoding";

/** The conditions the health job texts about. ops owns their meaning; this is the set of wordings. */
export const ONCALL_TEXT_CONDITIONS = [
  "queue_stuck",
  "delivery_unknown",
  "sender_stalled",
  "smart_encoding_on",
  "signature_failures",
  "job_failed",
  "translation_fallback",
  "publish_failed",
  "transactional_ceiling",
  "cap_overrun",
  "messaging_settings",
  "provider_auth",
] as const;
export type OncallTextCondition = (typeof ONCALL_TEXT_CONDITIONS)[number];

export interface RenderedOncallText {
  body: string;
  encoding: SmsEncoding;
  segments: number;
}

export function renderOncallText(condition: OncallTextCondition, count: number): RenderedOncallText {
  const body = normaliseSms(englishText(`ops.oncall.text.${condition}`, { count }));
  const counted = countSms(body);
  return { body, encoding: counted.encoding, segments: counted.segments };
}

/**
 * The text to the on-duty Admin about an escalation (S08.08, E08 "Escalation"): "{status}: {building}, floor {n}. Open: {link}" after the on-call texts'
 * "CVH:", in English (`ops.oncall.escalation.*`). The caller (checkins) passes the building's address, the floor's label and the staff link to the
 * escalation's page; the resident's number is never given to it, so it cannot be in the text.
 */
export function renderEscalationText(input: { status: "not_reached" | "needs_help"; building: string; floor: string; link: string }): RenderedOncallText {
  const body = normaliseSms(englishText(`ops.oncall.escalation.${input.status}`, { building: input.building, floor: input.floor, link: input.link }));
  const counted = countSms(body);
  return { body, encoding: counted.encoding, segments: counted.segments };
}
