// A preview of the English text message of an entry that has not been submitted (S04.05, AD-21): what the composer shows next to the
// text, so the author sees where the 911 line, the verification marker, the attribution, the link and "Reply STOP" fall and how many
// segments it takes. It is made by messaging's one renderer, the same call that makes the frozen body at submit, with the draft's
// words: a preview, not a body (nothing is frozen, counted for cost or hashed). The public origin comes in as an argument. Pure.
import { render, type RenderedSms, type SmsAttribution } from "../../messaging";
import type { EntryContent } from "../domain/content";
import type { EntryKind } from "../domain/lifecycle";

export interface PreviewContext {
  kind: EntryKind;
  isDrill: boolean;
  /** The thread's public slug: the text links to `/a/{slug}`. */
  slug: string;
  /** "Verified by the Hub" when true: true for every entry the Hub's staff approve (epic E04, Verification marker). */
  verified: boolean;
  attribution: SmsAttribution;
}

/** The English text message of a draft, rendered as the submit will render it. */
export function previewSms(content: Pick<EntryContent, "text" | "types">, context: PreviewContext, publicBaseUrl: string): RenderedSms {
  return render(
    { kind: context.kind, types: content.types, text: content.text, verified: context.verified, attribution: context.attribution, translations: [] },
    "en",
    context.isDrill,
    context.slug,
    publicBaseUrl,
  );
}
