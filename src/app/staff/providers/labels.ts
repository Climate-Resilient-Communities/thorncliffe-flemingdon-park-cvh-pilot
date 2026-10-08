import { englishText } from "@/i18n/text";
import type { ProviderFiltersLabels } from "./ProviderFilters";
import type { ProviderListLabels } from "./ProviderList";

const LABEL_KEYS = [
  "statusPublished",
  "statusUnpublished",
  "statusRemoved",
  "removedNote",
  "confirmedOn",
  "notConfirmed",
  "change",
  "confirm",
  "confirmDate",
  "dateHint",
  "confirmFirst",
  "saveDate",
  "actionsOf",
  "publish",
  "unpublish",
] as const;

// Placeholders the row fills itself: the date it formats and the provider's name.
const KEEP: Partial<Record<(typeof LABEL_KEYS)[number], Record<string, string>>> = { confirmedOn: { date: "{date}" }, actionsOf: { name: "{name}" } };

/** The list's labels from the catalog, resolved on the server so the catalog never reaches the browser. `{date}` and `{name}` stay for the row to fill. */
export function providerListLabels(): ProviderListLabels {
  return Object.fromEntries(
    LABEL_KEYS.map((key) => [key, key === "confirmFirst" ? englishText("staff.providers.errors.confirmFirst") : englishText(`staff.providers.${key}`, KEEP[key])]),
  ) as unknown as ProviderListLabels;
}

/** The filter tabs' and the search's labels. */
export function providerFiltersLabels(): ProviderFiltersLabels {
  const t = (key: string) => englishText(`staff.providers.${key}`);
  return {
    filters: t("filters"),
    filterAll: t("filterAll"),
    filterToConfirm: t("filterToConfirm"),
    filterHidden: t("filterHidden"),
    search: t("search"),
    searchSubmit: t("searchSubmit"),
    clearSearch: t("clearSearch"),
  };
}
