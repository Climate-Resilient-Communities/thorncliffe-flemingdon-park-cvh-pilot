// The words of the Directory release screen that more than one file needs. Imports types only, so the screen's
// pieces (and the screenshot harness) load no module code.
import { englishText } from "@/i18n/text";
import type { CatalogueMismatch, PublishFailureCode } from "@/modules/directory";

const REASON_KEYS: Record<PublishFailureCode, string> = {
  storage_unavailable: "staff.directory.reasons.storageUnavailable",
  invalid_catalogue: "staff.directory.reasons.invalidCatalogue",
  catalogue_unreadable: "staff.directory.reasons.catalogueUnreadable",
  catalogue_not_loaded: "staff.directory.reasons.catalogueNotLoaded",
  search_mismatch: "staff.directory.reasons.searchMismatch",
  embedding_unavailable: "staff.directory.reasons.embeddingUnavailable",
  usage_allowance_exceeded: "staff.directory.reasons.usageAllowanceExceeded",
  search_config_invalid: "staff.directory.reasons.searchConfigInvalid",
  gave_up: "staff.directory.reasons.gaveUp",
  unexpected: "staff.directory.reasons.unexpected",
};

/** The words of a failure code, for "Publish failed: {reason}". A code this screen does not know reads as "something went wrong". */
export const failureReason = (code: PublishFailureCode | string): string =>
  englishText(code in REASON_KEYS ? REASON_KEYS[code as PublishFailureCode] : REASON_KEYS.unexpected);

const FIELD_KEYS: Record<string, string> = {
  services: "staff.directory.fields.services",
  emergency_role: "staff.directory.fields.emergencyRole",
  name: "staff.directory.fields.name",
};

/** The field a text key names, as the Admin reads it: `emergency_role` is "Emergency role". */
export const fieldLabel = (text: string): string => (text in FIELD_KEYS ? englishText(FIELD_KEYS[text]) : text);

/** A language code as its English name: `ur` is "Urdu", `zh-Hant` is "Chinese (Traditional)". */
export function languageName(lang: string): string {
  const key = `staff.directory.languages.${lang === "zh-Hant" ? "zhHant" : lang}`;
  try {
    return englishText(key);
  } catch {
    return lang;
  }
}

/**
 * Every stale translation of a release report as a line: `Legal Aid Ontario: Services, Urdu`. The name is the one the
 * release stored at plan time; a report made before names were stored shows the subject's id.
 */
export function staleLines(report: { stale: readonly { subject: string; name?: string; text: string; lang: string }[] }): string[] {
  return report.stale.map((item) =>
    englishText("staff.directory.staleItem", { name: item.name ?? item.subject, field: fieldLabel(item.text), language: languageName(item.lang) }),
  );
}

/** The 12 first digits of a catalogue hash: enough to tell two apart on a screen. */
const shortHash = (hash: string): string => hash.slice(0, 12);

/**
 * "The database holds catalogue X, this deployment has Y: run `npm run seed:providers` from commit Z, then publish."
 * Z is the commit the deployment was built from (a local build has none, and is told so in words).
 */
export function catalogueMismatchText(mismatch: CatalogueMismatch): string {
  const commit = mismatch.commit === null ? englishText("staff.directory.commitUnknown") : englishText("staff.directory.commitNamed", { sha: mismatch.commit.slice(0, 7) });
  return mismatch.loaded === null
    ? englishText("staff.directory.catalogueNeverLoaded", { deployed: shortHash(mismatch.deployed), commit })
    : englishText("staff.directory.catalogueMismatch", { loaded: shortHash(mismatch.loaded), deployed: shortHash(mismatch.deployed), commit });
}
