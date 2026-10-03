// The alert texts an approval queues (S04.07's wiring of S06.01, AD-8): from who gets the text (subscriptions' `captureRecipients`) and the entry's
// frozen text messages, the texts handed to messaging's `enqueueAlertDeliveries(tx, entryId, texts)`; and from the texts that call returns, the count the
// approval audits and compares with the reviewed one. Pure: the approval's transaction does the writing.
//
// Each text is the entry's frozen text message for the person's language, byte for byte, with its segment count (the database refuses an alert delivery
// whose body or segments are not the entry's frozen ones): the person's own language where the entry has a text message in it, the English one where it
// has none (zh-Hant has no text message of its own, and a fallback language's is the English one), and the person is counted under the language of the
// body they get, which is also the cost estimate's grouping (AD-21).
import type { RecipientCounts } from "../../../contracts/alertApproval";
import { LANG_CODES, type LangCode } from "../../../contracts/lang";
import { estimateSmsCost } from "../../messaging";
import type { AlertRecipient, RecipientSmsBody } from "../../subscriptions";

/** One alert text, as `enqueueAlertDeliveries` takes it. */
export interface AlertText {
  recipient: { kind: "subscriber" | "roster"; id: string };
  /** The language of the body (English for a person whose own language has no text message). */
  lang: LangCode;
  body: string;
  segments: number;
  /** This text's own estimate in whole cents CAD, rounded up (segments x the configured price per segment). */
  costEstimateCents: number;
}

const isLang = (value: unknown): value is LangCode => typeof value === "string" && (LANG_CODES as readonly string[]).includes(value);

/**
 * The texts for the people captured: one per person (a person named twice gets one: the key of an alert delivery is the entry and the
 * recipient), in the order given, each person's id in lowercase (the ids the database gives are; messaging refuses an uppercase one).
 * No one captured: no text, and no price is needed. Throws for what a correct port never gives: a language that is not one, an entry with
 * no English text message, a price that is not one while someone is to be texted.
 */
export function alertTextsOf(input: {
  recipients: readonly AlertRecipient[];
  smsBodies: Readonly<Record<string, RecipientSmsBody>>;
  /** Cents CAD per segment; asked for only when someone is to be texted. */
  pricePerSegmentCents: (() => number) | undefined;
}): AlertText[] {
  if (input.recipients.length === 0) return [];
  const english = input.smsBodies.en;
  if (!english) throw new Error("alerting: the entry has no frozen English text message to send");
  if (input.pricePerSegmentCents === undefined) throw new Error("alerting: no price per segment is wired, so the texts' cost cannot be estimated");
  const price = input.pricePerSegmentCents();
  const cents = new Map<LangCode, number>();
  const centsOf = (lang: LangCode, segments: number) => {
    let known = cents.get(lang);
    if (known === undefined) {
      known = estimateSmsCost({ segmentsByLanguage: { [lang]: segments }, recipientsByLanguage: { [lang]: 1 }, pricePerSegmentCents: price, basis: "snapshot" }).cents;
      cents.set(lang, known);
    }
    return known;
  };
  const seen = new Set<string>();
  const texts: AlertText[] = [];
  for (const recipient of input.recipients) {
    if (!isLang(recipient.lang)) throw new Error("alerting: the recipient port gave a language that is not one");
    const id = recipient.id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const own = input.smsBodies[recipient.lang];
    const lang: LangCode = own ? recipient.lang : "en";
    const frozen = own ?? english;
    texts.push({ recipient: { kind: recipient.kind, id }, lang, body: frozen.body, segments: frozen.segments, costEstimateCents: centsOf(lang, frozen.segments) });
  }
  return texts;
}

/** The count of people the queued texts reach, in all and by the language of the text each gets: the number of texts returned. */
export function countsOfTexts(queued: readonly { lang: string }[]): RecipientCounts {
  const byLanguage: Partial<Record<LangCode, number>> = {};
  for (const { lang } of queued) {
    if (!isLang(lang)) throw new Error("alerting: the outbox returned a text in a language that is not one");
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
  }
  return { total: queued.length, byLanguage };
}
