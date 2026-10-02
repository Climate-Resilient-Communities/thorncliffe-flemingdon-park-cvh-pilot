// The words of the Directory release screen that more than one file needs. Imports types only, so the screen's
// pieces (and the screenshot harness) load no module code.
import { englishText } from "@/i18n/text";
import type { PublishFailureCode, ReleaseReport } from "@/modules/directory";

const REASON_KEYS: Record<PublishFailureCode, string> = {
  storage_unavailable: "staff.directory.reasons.storageUnavailable",
  invalid_catalogue: "staff.directory.reasons.invalidCatalogue",
  search_mismatch: "staff.directory.reasons.searchMismatch",
  gave_up: "staff.directory.reasons.gaveUp",
  unexpected: "staff.directory.reasons.unexpected",
};

/** The words of a failure code, for "Publish failed: {reason}". A code this screen does not know reads as "something went wrong". */
export const failureReason = (code: PublishFailureCode | string): string =>
  englishText(code in REASON_KEYS ? REASON_KEYS[code as PublishFailureCode] : REASON_KEYS.unexpected);

/** Every stale translation of a release report as a line: `M014, services, ur`. */
export function staleLines(report: Pick<ReleaseReport, "stale">): string[] {
  return report.stale.map((item) => englishText("staff.directory.staleItem", { subject: item.subject, text: item.text, lang: item.lang }));
}
