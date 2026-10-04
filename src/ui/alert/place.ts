// Where an alert is, in words (the share message and its link's preview, S05.08): a neighbourhood audience is the neighbourhoods' names, a buildings audience the
// addresses of its buildings (the first few, then "and 3 more"). Pure: the addresses come in (the building list the app already keeps), and a building the list does
// not know is left out. When nothing can be named the answer is null and the message says nothing about the place rather than guessing one.
import type { Audience } from "@/contracts/audience";
import type { Translate } from "./times";

/** How many addresses are named before the rest are counted. */
export const PLACE_ADDRESSES_SHOWN = 3;

/**
 * The neighbourhoods the catalog names (its `neighbourhoods` keys; place.test.ts keeps the two equal). An id outside it is left out without asking the catalog
 * for it: a key the catalog does not have is an error to next-intl (a thrown MISSING_MESSAGE under test, a logged one in the app), not a way to find out.
 */
export const NAMED_NEIGHBOURHOODS: ReadonlySet<string> = new Set(["TP", "FP"]);

export function placeLine(audience: Audience, addresses: ReadonlyMap<string, string>, locale: string, t: Translate): string | null {
  if (audience.scope === "neighbourhood") {
    const names = audience.neighbourhood_ids.filter((id) => NAMED_NEIGHBOURHOODS.has(id)).map((id) => t(`neighbourhoods.${id}`));
    return names.length === 0 ? null : new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
  }
  const known = audience.buildings.flatMap(({ rsn }) => {
    const address = addresses.get(rsn);
    return address === undefined || address.trim() === "" ? [] : [address.trim()];
  });
  if (known.length === 0) return null;
  const shown = known.slice(0, PLACE_ADDRESSES_SHOWN);
  const rest = audience.buildings.length - shown.length;
  if (rest <= 0) return new Intl.ListFormat(locale, { type: "conjunction" }).format(shown);
  return `${new Intl.ListFormat(locale, { type: "unit", style: "short" }).format(shown)} ${t("R29.placeMore", { n: rest })}`;
}
