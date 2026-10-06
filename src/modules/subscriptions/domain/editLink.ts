// The one-time web link's rules (S07.06, E07 definition "Edit link", AD-13). Pure: no I/O, no clock.
//
// A link is `/{lang}/subscription/{token}` on the public origin: 32 random bytes in base64url (43 characters), of which only the sha256 is
// stored. The page's choices are the subscriber's rows read back as the sign-up form sends them (a building and its floors), and a change
// writes them back the same way: a building with no floor chosen is one row with no floor, a building with floors one row per floor. The
// check-in group (`checkin`) is E08's: the page neither shows nor changes it.
import { SUBSCRIPTION_SEGMENT } from "../../../contracts/subscriptionEdit";

/** The `transactional` purpose of the link's text and of a change's confirmation (E06's allow-list: "edit links", 30 minutes). */
export const EDIT_LINK_PURPOSE = "edit_link";

/**
 * How many links one number may be sent by text in a Toronto day, and the scope of the keyed hashes that count them in `rate_limit` (deleted after 24
 * hours, as every other). Each link is a text the CVH pays for and the limit of the inbound router does not see (its offer can be reopened by closing a
 * menu, which counts as a menu reply, not a menu start); a fourth request that day is answered with the Hub's number (`smsTexts.menuHub`) and no link.
 * The hash is the menu limit's (`MENU_SCOPE`, the one the router gives the menus): `hashScopeOf` says so for a reader that looks a number's hashes up.
 */
export const EDIT_LINKS_PER_DAY = 3;
export const EDIT_LINK_SCOPE = "sms_edit_link";

/** The link texted to the subscriber: the page in its language on the public origin. */
export function editLinkUrl(publicBaseUrl: string, lang: string, token: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}/${lang}/${SUBSCRIPTION_SEGMENT}/${token}`;
}

/** A token standing alone (exactly 43 base64url characters), and the page's path (`/{lang}/subscription/{anything}`). */
const TOKEN_ALONE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const PAGE_PATH = new RegExp(`/([a-z]{2,3})/${SUBSCRIPTION_SEGMENT}/[^/?#\\s"']+`, "g");

/**
 * The text with every edit link token taken out (AD-13: a log line never carries one): the last segment of a page path
 * `/{lang}/subscription/...`, whatever it is (the API's own paths, `/api/subscription/view`, are left as they are), and any run of exactly 43
 * base64url characters, which is what a token is. Hex hashes (64), ids (36) and Twilio SIDs (34) are other lengths and are left as they are.
 */
export function redactEditTokens(text: string): string {
  return text
    .replace(PAGE_PATH, (whole, lang: string) => (lang === "api" ? whole : `/${lang}/${SUBSCRIPTION_SEGMENT}/[token]`))
    .replace(TOKEN_ALONE, "[token]");
}

/** One saved row: a building and one floor in it, or none. */
export interface PlaceRow {
  rsn: string;
  floorId: string | null;
}

/** The rows of the page's places: a building with floors is one row per floor, a building without one row with no floor. */
export function placeRows(places: readonly { rsn: string; floors: readonly string[] }[]): PlaceRow[] {
  return places.flatMap((place): PlaceRow[] => (place.floors.length === 0 ? [{ rsn: place.rsn, floorId: null }] : place.floors.map((floorId) => ({ rsn: place.rsn, floorId }))));
}

/** Code-unit order: the same on every machine and in every locale. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The page's places from the rows, by building number, floors sorted: a row with no floor adds the building only. */
export function placesOfRows(rows: readonly PlaceRow[]): { rsn: string; floors: string[] }[] {
  const byRsn = new Map<string, Set<string>>();
  for (const row of rows) {
    const floors = byRsn.get(row.rsn) ?? new Set<string>();
    if (row.floorId !== null) floors.add(row.floorId);
    byRsn.set(row.rsn, floors);
  }
  return [...byRsn.entries()].sort(([a], [b]) => byText(a, b)).map(([rsn, floors]) => ({ rsn, floors: [...floors].sort(byText) }));
}

/** Whether two sets of rows name the same buildings and floors (their order and repeats aside). */
export function samePlaces(a: readonly PlaceRow[], b: readonly PlaceRow[]): boolean {
  return JSON.stringify(placesOfRows(a)) === JSON.stringify(placesOfRows(b));
}

/** The check-in group, which E08 sets with its own consent and coverage check: kept as it is by a change on the page. */
export const KEPT_GROUPS: readonly string[] = ["checkin"];

/** The subscriber's groups after a change: the ones chosen on the page, and those the page does not show kept as they were. */
export function groupsAfterChange(current: readonly string[], chosen: readonly string[]): string[] {
  return [...chosen, ...current.filter((group) => KEPT_GROUPS.includes(group) && !chosen.includes(group))];
}
