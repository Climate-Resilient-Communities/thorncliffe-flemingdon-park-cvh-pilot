import { englishText } from "@/i18n/text";
import type { ProviderListLabels } from "./ProviderList";

const LABEL_KEYS = [
  "statusPublished",
  "statusUnpublished",
  "statusRemoved",
  "removedNote",
  "neverConfirmed",
  "confirmDate",
  "confirmedOn",
  "dateHint",
  "confirmFirst",
  "saveDate",
  "publish",
  "unpublish",
] as const;

/** The list's labels from the catalog, resolved on the server so the catalog never reaches the browser. `{date}` stays for the row to fill. */
export function providerListLabels(): ProviderListLabels {
  return Object.fromEntries(
    LABEL_KEYS.map((key) => [
      key,
      key === "confirmedOn"
        ? englishText("staff.providers.confirmedOn", { date: "{date}" })
        : key === "confirmFirst"
          ? englishText("staff.providers.errors.confirmFirst")
          : englishText(`staff.providers.${key}`),
    ]),
  ) as unknown as ProviderListLabels;
}
