// The rules of a provider's publication state and last-confirmed date (S02.04, FR-G4, NFR-N7).
// Pure; application/providers.ts applies them under a row lock and audits the outcome.
//
//  - a provider is published only after an Admin has set its last-confirmed date ("Confirm this
//    provider first") and only while it is in the catalogue;
//  - the last-confirmed date is a real calendar date, today (Toronto) or earlier;
//  - the screens never change listing text: the only fields these rules cover are `published`
//    and `lastConfirmed` (text changes go through the catalogue scripts, AD-11).
import { isIsoDate } from "@/contracts/contentReview";

export interface ProviderState {
  published: boolean;
  inCatalogue: boolean;
  /** YYYY-MM-DD, or null when no Admin has confirmed the provider yet. */
  lastConfirmed: string | null;
}

export const PROVIDER_ERRORS = [
  "not_found",
  "confirm_first",
  "not_in_catalogue",
  "already_published",
  "not_published",
  "date_invalid",
  "date_in_future",
] as const;
export type ProviderError = (typeof PROVIDER_ERRORS)[number];

export type ProviderDecision = { ok: true } | { ok: false; error: ProviderError };

const OK: ProviderDecision = { ok: true };
const refuse = (error: ProviderError): ProviderDecision => ({ ok: false, error });

/** Whether the provider may be published now. */
export function decidePublish(provider: ProviderState): ProviderDecision {
  if (!provider.inCatalogue) return refuse("not_in_catalogue");
  if (provider.published) return refuse("already_published");
  if (provider.lastConfirmed === null) return refuse("confirm_first");
  return OK;
}

/** Whether the provider may be unpublished now. */
export function decideUnpublish(provider: ProviderState): ProviderDecision {
  return provider.published ? OK : refuse("not_published");
}

/** Whether the last-confirmed date may be set to `date` on `today` (both YYYY-MM-DD, today in Toronto). */
export function decideConfirm(provider: Pick<ProviderState, "inCatalogue">, date: unknown, today: string): ProviderDecision {
  if (!provider.inCatalogue) return refuse("not_in_catalogue");
  if (!isIsoDate(date)) return refuse("date_invalid");
  if (date > today) return refuse("date_in_future");
  return OK;
}

/** Today's date in Toronto as YYYY-MM-DD: a date picked on the Hub's screen is a Toronto date. */
export function torontoDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
