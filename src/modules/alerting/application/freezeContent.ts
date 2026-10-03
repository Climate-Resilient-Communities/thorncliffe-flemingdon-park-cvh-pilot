// What a submit freezes besides the translations (AD-21, S04.06): each language's text message rendered once by
// messaging's renderer, counted, and the content hash an approval binds to. Pure: it reads no clock, no
// environment and no database, so it runs outside any lock, like the translation it follows (S04.02), and gives
// the same result for the same input. The public origin comes in as an argument; the composition root reads it
// from src/platform/config/env.ts (PUBLIC_BASE_URL).
//
// S04.05's submit calls this with the translations S04.02 returned and hands the result to the lifecycle's
// `submit` as the `FrozenContent`.
import { sha256Hex } from "../../../platform/hash";
import { SMS_MAX_BODY_LENGTH, renderAll, type SmsAttribution } from "../../messaging";
import type { EntryContent } from "../domain/content";
import { contentHash } from "../domain/hash";
import type { EntryKind } from "../domain/lifecycle";
import type { FreezeResult, FrozenContent, FrozenSmsBody } from "./ports";
import type { FrozenTranslation } from "../domain/translations";

export interface FreezeInput {
  alertId: string;
  kind: EntryKind;
  /** The entry a correction or withdrawal replaces; null for every other entry. */
  supersedesId: string | null;
  isDrill: boolean;
  /** What the entry goes out on, such as `["sms", "web"]`. */
  channels: readonly string[];
  /** The draft as it was when Submit was pressed. */
  content: EntryContent;
  /** The translations of every language but English, as S04.02 returned them. */
  translations: readonly FrozenTranslation[];
  /** "Verified by the Hub" in the texts when true, "Not yet verified" when false. */
  verified: boolean;
  attribution: SmsAttribution;
  /** The thread's public slug: the texts link to `/a/{slug}`. */
  slug: string;
  /** PUBLIC_BASE_URL, from the validated environment. */
  publicBaseUrl: string;
}

/**
 * Nothing is frozen when:
 * - `SMS_BODY_TOO_LONG`: a text the provider would refuse (more than 1600 characters) in one language. Translation
 *   can make a 600-character English text longer than that in a script that needs more characters.
 * - `TRANSLATION_STALE`: a translation was made from other English than the draft being frozen (its `sourceHash` is
 *   not the SHA-256 of the draft's text), such as a set that was still in flight when "Try translation again" ran
 *   after the author edited the text. The approver would approve, and residents would receive, text translated
 *   from words the author no longer has. The caller translates again.
 * Both name the language and never the text.
 */
export type { FreezeRefusal, FreezeResult } from "./ports";

/** The text messages of every launch language, the web texts and the hash of all of it. */
export function freezeContent(input: FreezeInput): FreezeResult {
  const { content } = input;
  // The source hash is of the raw English text, as the translation (S04.02) and the content hash (hash.ts) take it.
  const sourceHash = sha256Hex(content.text);
  const stale = input.translations.find((translation) => translation.sourceHash !== sourceHash);
  if (stale) return { ok: false, error: "TRANSLATION_STALE", lang: stale.lang };
  const rendered = renderAll(
    { kind: input.kind, types: content.types, text: content.text, verified: input.verified, attribution: input.attribution, translations: input.translations },
    input.isDrill,
    input.slug,
    input.publicBaseUrl,
  );
  const smsBodies: Record<string, FrozenSmsBody> = {};
  for (const [lang, sms] of Object.entries(rendered)) {
    if (sms.body.length > SMS_MAX_BODY_LENGTH) return { ok: false, error: "SMS_BODY_TOO_LONG", lang };
    smsBodies[lang] = { body: sms.body, encoding: sms.encoding, segments: sms.segments };
  }
  const hash = contentHash({
    kind: input.kind,
    alertId: input.alertId,
    supersedesId: input.supersedesId,
    types: content.types,
    phase: content.phase,
    audience: content.audience,
    channels: input.channels,
    isDrill: input.isDrill,
    validUntil: content.validUntil,
    text: content.text,
    smsBodies,
    webTexts: input.translations,
  });
  return { ok: true, value: { contentHash: hash, smsBodies, translations: input.translations } };
}
