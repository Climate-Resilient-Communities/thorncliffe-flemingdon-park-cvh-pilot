// The text to the on-call Admins (AD-21, S06.07): messaging's renderer builds it like every other outbound text, so it is normalised and counted
// the same way. The caller (ops' health job) passes the condition and a count; the wording is in the catalog (`ops.oncall.text.*`), English only
// (the on-call Admins read English in the pilot), and carries no personal data.
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
