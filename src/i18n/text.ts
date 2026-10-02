import { createTranslator, type AbstractIntlMessages } from "next-intl";
import en from "./messages/en.json";

const translateEnglish = createTranslator({
  locale: "en",
  messages: en as unknown as AbstractIntlMessages,
  onError: (error) => {
    throw error;
  },
}) as unknown as (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * An English catalog string by its full key (for example `staff.bootstrap.incomplete`), with its
 * `{placeholders}` filled. The Hub's staff screens and IT's scripts are in English in the pilot;
 * the strings still come from the catalog (design/prototype/cvh → npm run gen:strings) so they
 * can be translated later without changing code. Throws on a key the catalog does not have.
 */
export function englishText(key: string, values?: Record<string, string | number>): string {
  return translateEnglish(key, values);
}
