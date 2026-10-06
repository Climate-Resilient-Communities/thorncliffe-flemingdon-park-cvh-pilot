// The numbered text menus' rules (S07.05, AD-9; E07 definitions "Menu", "Reply 0", "Building change by text"). Pure: no I/O, no clock.
//
// Reply 1 runs the building menu: the streets of the pilot buildings (most buildings first), then the buildings on the chosen street (by
// their number), then the building's floors, the whole building first; when more than one building is saved, a warning comes before
// anything else ("This replaces your {n} saved buildings. 1 Continue, 0 Back"). Reply 2 runs the language menu: the 15 launch languages,
// each in its own name. Nothing changes until the last step is completed: `save_building` (one building, and one floor or none, replacing
// every saved building) or `save_language`.
//
// Each page numbers its options 1 to 7, as many as fit one text in the subscriber's language (`paginate`, with messaging's encoder as
// `fits`), and 0, 8 and 9 are reserved on every page: 0 goes back (to the page before, then to the step before; at the first step it
// closes the menu), 8 shows the next page (offered only when there is one) and 9 gives the Hub's number. Any other reply sends the page
// again. A page is the `sms_prompt` row of the subscriber: `kind` names the menu and `step` holds the page shown with the ids of its
// options, so a reply picks exactly what the resident was sent, even if an Admin has added a floor since.
//
// A menu is open for 10 minutes after its last message (MENU_IDLE_MS); after that a reply is told the menu has reset and is read as a new
// keyword (domain/inbound.ts, `menu_idle`). The row is kept for an hour (MENU_KEPT_MS, the most `sms_prompt` allows) so that a reply in
// that hour can be told; the purge job deletes it after. A number may start 5 menus a day (MENUS_PER_DAY, Toronto's day).
import { z } from "zod";
import { HUB_PHONE_E164 } from "../../../contracts/hubNumber.generated";
import { displayPhone } from "../../../contracts/phone";
import { LAUNCH_LANGUAGES, isLaunchCode, type LaunchCode } from "../../../i18n/languages";
import { residentText, type ResidentTextName } from "../../../i18n/residentTexts";
import { normaliseReply, type OpenPrompt } from "./inbound";

/** A menu with no reply for this long has reset (E07 "Menu"). */
export const MENU_IDLE_MS = 10 * 60_000;
/** How long a menu's row is kept after its last message, so that a late reply is told the menu reset: `sms_prompt`'s longest. */
export const MENU_KEPT_MS = 60 * 60_000;
/** Menus a number may start in a day (Toronto). */
export const MENUS_PER_DAY = 5;
/** The scope of the daily menu limit's keyed hashes in `rate_limit`. */
export const MENU_SCOPE = "sms_menu";
/** Selectable options on one page, numbered 1 to 7. */
export const OPTIONS_PER_PAGE = 7;
/** The reserved replies of every menu page. */
export const BACK = 0;
export const MORE = 8;
export const HUB = 9;

/** The `sms_prompt` kinds of the menus. */
export const MENU_PROMPT_KINDS = ["menu_building", "menu_language"] as const;
export type MenuPromptKind = (typeof MENU_PROMPT_KINDS)[number];
export const isMenuPromptKind = (kind: string): kind is MenuPromptKind => (MENU_PROMPT_KINDS as readonly string[]).includes(kind);

/**
 * The `sms_prompt` kind of the edit link's offer (S07.06): at the daily menu limit, once the edit link exists, the reply offers it ("Reply 1
 * for a link") and this prompt is open for 10 minutes; a 1 in that time asks for the link.
 */
export const EDIT_LINK_OFFER_KIND = "edit_link_offer";
export const EDIT_LINK_OFFER_MS = 10 * 60_000;

/** The Hub's number as a resident dials it: (416) 421-8997. */
export const HUB_NUMBER = displayPhone(HUB_PHONE_E164);

/**
 * The open prompt the decision table reads (domain/inbound.ts) from the subscriber's `sms_prompt` row that has not run out
 * (subscriberStore.promptOf): S07.04's deletion confirmation; a menu, open, or `menu_idle` once its last message is 10 minutes old; the
 * edit link's offer. Any other kind is no prompt.
 */
export function openPromptOf(row: { kind: string; idle: boolean } | null): OpenPrompt {
  if (row === null) return "none";
  if (row.kind === "delete_confirm") return "delete_confirm";
  if (isMenuPromptKind(row.kind)) return row.idle ? "menu_idle" : "menu";
  if (row.kind === EDIT_LINK_OFFER_KIND) return "edit_link_offer";
  return "none";
}

/** The reply as a menu reads it: one digit 0 to 9 in any script (Reply normalisation), or null for anything else. */
export function menuDigit(body: string): number | null {
  const text = normaliseReply(body);
  return /^[0-9]$/.test(text) ? Number(text) : null;
}

// ---------------------------------------------------------------------------------------------------------
// The step kept in `sms_prompt.step`
// ---------------------------------------------------------------------------------------------------------

const Page = z.number().int().min(0).max(999);
const Street = z.string().min(1).max(200);
const Rsn = z.string().regex(/^[0-9]{1,9}$/);
const FloorId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
/** How many buildings were saved when the menu started: the warning was shown when more than one. */
const Saved = z.number().int().min(0).max(9999);
const options = <T extends z.ZodType>(item: T) => z.array(item).min(1).max(OPTIONS_PER_PAGE);

const BuildingStepSchema = z.discriminatedUnion("stage", [
  z.strictObject({ stage: z.literal("warn"), saved: Saved }),
  z.strictObject({ stage: z.literal("street"), saved: Saved, page: Page, options: options(Street) }),
  z.strictObject({ stage: z.literal("building"), saved: Saved, street: Street, streetPage: Page, page: Page, options: options(Rsn) }),
  z.strictObject({ stage: z.literal("floor"), saved: Saved, street: Street, streetPage: Page, rsn: Rsn, buildingPage: Page, page: Page, options: options(FloorId.nullable()) }),
]);
const LanguageStepSchema = z.strictObject({ stage: z.literal("language"), page: Page, options: options(z.string().refine(isLaunchCode)) });

export type BuildingStep = z.infer<typeof BuildingStepSchema>;
export type LanguageStep = Omit<z.infer<typeof LanguageStepSchema>, "options"> & { options: LaunchCode[] };

/** An open menu: its prompt kind and its step. */
export type Menu = { kind: "menu_building"; step: BuildingStep } | { kind: "menu_language"; step: LanguageStep };

/** The menu a prompt row holds, or null when the row is not a menu or its step is not one (it is then closed). */
export function readMenu(kind: string, step: unknown): Menu | null {
  if (kind === "menu_building") {
    const parsed = BuildingStepSchema.safeParse(step);
    return parsed.success ? { kind, step: parsed.data } : null;
  }
  if (kind === "menu_language") {
    const parsed = LanguageStepSchema.safeParse(step);
    return parsed.success ? { kind, step: parsed.data as LanguageStep } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// What a menu lists
// ---------------------------------------------------------------------------------------------------------

/** A pilot building as the menu lists it: places' address split into its number and street (places' `streetOf`), and its neighbourhood. */
export interface MenuBuilding {
  rsn: string;
  address: string;
  street: string;
  number: string | null;
  neighbourhoodId: string;
}

export interface MenuFloor {
  id: string;
  label: string;
}

/** What a menu step reads: the subscriber's language, the buildings, the floors of the building a reply may need, and the encoder. */
export interface MenuWorld {
  lang: LaunchCode;
  /** Every pilot building (the building menu only; the language menu lists none). */
  buildings: readonly MenuBuilding[];
  /** The floors, lowest first, of each building `floorsWanted` named; a building that is not there is absent. */
  floors: ReadonlyMap<string, readonly MenuFloor[]>;
  /** Whether a text fits one segment in its encoding (messaging's `countSms`, after its normalisation). */
  fits: (text: string) => boolean;
}

interface Item<T> {
  value: T;
  label: string;
}

/** Code-unit order: the same on every machine and in every locale. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** The leading whole number of a house number ("85-95" is 85), for ordering; Infinity when there is none. */
const leadingNumber = (text: string | null) => (text !== null && /^[0-9]+/.test(text) ? Number(/^[0-9]+/.exec(text)![0]) : Number.POSITIVE_INFINITY);

/** The streets of the buildings, the street with most buildings first (most residents find theirs on the first page), then by name. */
export function streetsOf(buildings: readonly MenuBuilding[]): string[] {
  const counts = new Map<string, number>();
  for (const building of buildings) counts.set(building.street, (counts.get(building.street) ?? 0) + 1);
  return [...counts.entries()].sort(([a, m], [b, n]) => n - m || byText(a, b)).map(([street]) => street);
}

/** The buildings on a street, by house number (numerically), each named by its number, or its address when it has none. */
export function buildingsOn(buildings: readonly MenuBuilding[], street: string): Item<string>[] {
  return buildings
    .filter((building) => building.street === street)
    .sort((a, b) => leadingNumber(a.number) - leadingNumber(b.number) || byText(a.number ?? a.address, b.number ?? b.address) || byText(a.rsn, b.rsn))
    .map((building) => ({ value: building.rsn, label: building.number ?? building.address }));
}

/** A floor page's options: the whole building (no floor) first, then the floors by their labels, lowest first. */
function floorItems(lang: LaunchCode, floors: readonly MenuFloor[]): Item<string | null>[] {
  return [{ value: null, label: residentText(lang, "menuWholeBuilding") }, ...floors.map((floor) => ({ value: floor.id, label: floor.label }))];
}

/** The 15 launch languages in the app's order, each in its own name. */
const languageItems = (): Item<LaunchCode>[] => LAUNCH_LANGUAGES.map((language) => ({ value: language.code, label: language.native }));

// ---------------------------------------------------------------------------------------------------------
// Texts and pages
// ---------------------------------------------------------------------------------------------------------

/** The catalog strings a page is made of, and its language, as a failure names them: "menuStreet + menuNav/menuNavMore in ur". */
export const pageName = (title: ResidentTextName, lang: LaunchCode): string => `${title} + menuNav/menuNavMore${title === "menuFloor" ? " + menuWholeBuilding" : ""} in ${lang}`;

/** A page: its title, its options numbered from 1, each on its own line ("1) Deauville Lane"), and the reserved replies. */
export function pageText(lang: LaunchCode, title: ResidentTextName, labels: readonly string[], more: boolean): string {
  return [residentText(lang, title), ...labels.map((label, index) => `${index + 1}) ${label}`), residentText(lang, more ? "menuNavMore" : "menuNav")].join("\n");
}

/**
 * A list cannot be shown because not even one of its options fits a text with the page's title and replies: a catalog string is too long.
 * The message names the page (`pageName`: its catalog strings and the language) and the text that did not fit.
 */
export class MenuPageTooLong extends Error {
  override name = "MenuPageTooLong";
}

/**
 * The pages of a list: from the first option on, each page takes as many as fit one text (`fits` of `render`), at most 7; a page that is
 * not the last also offers 8 (More), which `render` is told. Throws MenuPageTooLong, naming `what`, when one option alone does not fit.
 */
export function paginate<T>(items: readonly T[], render: (page: readonly T[], more: boolean) => string, fits: (text: string) => boolean, what = "A menu page"): T[][] {
  const pages: T[][] = [];
  let start = 0;
  while (start < items.length) {
    let size = Math.min(OPTIONS_PER_PAGE, items.length - start);
    while (size > 0 && !fits(render(items.slice(start, start + size), start + size < items.length))) size -= 1;
    if (size === 0) throw new MenuPageTooLong(`${what} cannot fit even one option in one text: ${JSON.stringify(render(items.slice(start, start + 1), start + 1 < items.length))}`);
    pages.push(items.slice(start, start + size));
    start += size;
  }
  return pages;
}

// ---------------------------------------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------------------------------------

/**
 * What a menu does with a reply:
 *  - `show`: the page `text` is sent and the menu stays open on `menu`;
 *  - `hub`: the Hub's number is sent and the menu stays where it was;
 *  - `close`: the menu closes having changed nothing (0 at the first step), and says so;
 *  - `save_building`: the last step of menu 1: one building, and its floor or none (the whole building), replaces every saved building;
 *  - `save_language`: the last step of menu 2.
 */
export type MenuMove =
  | { kind: "show"; menu: Menu; text: string }
  | { kind: "hub" }
  | { kind: "close" }
  | { kind: "save_building"; rsn: string; floorId: string | null }
  | { kind: "save_language"; lang: LaunchCode };

/** A list's page `page` (the last when it has fewer), or `close` for an empty list. */
function showList<T>(world: MenuWorld, items: readonly Item<T>[], title: ResidentTextName, page: number, menuOf: (page: number, options: T[]) => Menu): MenuMove {
  const pages = paginate(items, (slice, more) => pageText(world.lang, title, slice.map((item) => item.label), more), world.fits, pageName(title, world.lang));
  if (pages.length === 0) return { kind: "close" };
  const shown = Math.min(Math.max(page, 0), pages.length - 1);
  const slice = pages[shown]!;
  return { kind: "show", menu: menuOf(shown, slice.map((item) => item.value)), text: pageText(world.lang, title, slice.map((item) => item.label), shown < pages.length - 1) };
}

function warnPage(world: MenuWorld, saved: number): MenuMove {
  return { kind: "show", menu: { kind: "menu_building", step: { stage: "warn", saved } }, text: residentText(world.lang, "menuWarn", { n: String(saved) }) };
}

function streetPage(world: MenuWorld, saved: number, page: number): MenuMove {
  const items = streetsOf(world.buildings).map((street) => ({ value: street, label: street }));
  return showList(world, items, "menuStreet", page, (shown, options) => ({ kind: "menu_building", step: { stage: "street", saved, page: shown, options } }));
}

function buildingPage(world: MenuWorld, saved: number, street: string, streetPage: number, page: number): MenuMove {
  return showList(world, buildingsOn(world.buildings, street), "menuBuilding", page, (shown, options) => ({
    kind: "menu_building",
    step: { stage: "building", saved, street, streetPage, page: shown, options },
  }));
}

function floorPage(world: MenuWorld, from: { saved: number; street: string; streetPage: number; rsn: string; buildingPage: number }, floors: readonly MenuFloor[], page: number): MenuMove {
  return showList(world, floorItems(world.lang, floors), "menuFloor", page, (shown, options) => ({ kind: "menu_building", step: { stage: "floor", ...from, page: shown, options } }));
}

function languagePage(world: MenuWorld, page: number): MenuMove {
  return showList(world, languageItems(), "menuLanguage", page, (shown, options) => ({ kind: "menu_language", step: { stage: "language", page: shown, options } }));
}

/** Reply 1: the warning when more than one building is saved, otherwise the first page of streets. */
export function startBuildingMenu(world: MenuWorld, savedBuildings: number): MenuMove {
  return savedBuildings > 1 ? warnPage(world, savedBuildings) : streetPage(world, savedBuildings, 0);
}

/** Reply 2: the first page of languages. */
export function startLanguageMenu(world: MenuWorld): MenuMove {
  return languagePage(world, 0);
}

/** The option a digit picks on a page (wrapped, because a floor option may be null: the whole building), or null when it picks none. */
function pick<T>(options: readonly T[], digit: number | null): { value: T } | null {
  return digit !== null && digit >= 1 && digit <= options.length ? { value: options[digit - 1]! } : null;
}

/** The buildings whose floors answering `digit` on this menu may need: the one a building page's digit picks, or the floor page's own. */
export function floorsWanted(menu: Menu, digit: number | null): string[] {
  if (menu.kind !== "menu_building") return [];
  if (menu.step.stage === "floor") return [menu.step.rsn];
  if (menu.step.stage === "building") {
    const picked = pick(menu.step.options, digit);
    return picked ? [picked.value] : [];
  }
  return [];
}

/** A reply (its digit, or null) to an open menu. */
export function answerMenu(menu: Menu, digit: number | null, world: MenuWorld): MenuMove {
  if (digit === HUB) return { kind: "hub" };
  if (menu.kind === "menu_language") {
    const { page, options } = menu.step;
    if (digit === BACK) return page > 0 ? languagePage(world, page - 1) : { kind: "close" };
    if (digit === MORE) return languagePage(world, page + 1);
    const picked = pick(options, digit);
    return picked ? { kind: "save_language", lang: picked.value } : languagePage(world, page);
  }
  const step = menu.step;
  switch (step.stage) {
    case "warn":
      if (digit === 1) return streetPage(world, step.saved, 0);
      if (digit === BACK) return { kind: "close" };
      return warnPage(world, step.saved);
    case "street": {
      if (digit === BACK) return step.page > 0 ? streetPage(world, step.saved, step.page - 1) : step.saved > 1 ? warnPage(world, step.saved) : { kind: "close" };
      if (digit === MORE) return streetPage(world, step.saved, step.page + 1);
      const picked = pick(step.options, digit);
      return picked ? buildingPage(world, step.saved, picked.value, step.page, 0) : streetPage(world, step.saved, step.page);
    }
    case "building": {
      if (digit === BACK) return step.page > 0 ? buildingPage(world, step.saved, step.street, step.streetPage, step.page - 1) : streetPage(world, step.saved, step.streetPage);
      if (digit === MORE) return buildingPage(world, step.saved, step.street, step.streetPage, step.page + 1);
      const picked = pick(step.options, digit);
      const floors = picked ? world.floors.get(picked.value) : undefined;
      // A building with no floors recorded has nothing more to choose: the building is the last step.
      if (picked && floors?.length === 0) return { kind: "save_building", rsn: picked.value, floorId: null };
      if (picked && floors) return floorPage(world, { saved: step.saved, street: step.street, streetPage: step.streetPage, rsn: picked.value, buildingPage: step.page }, floors, 0);
      return buildingPage(world, step.saved, step.street, step.streetPage, step.page);
    }
    case "floor": {
      const floors = world.floors.get(step.rsn);
      const back = () => buildingPage(world, step.saved, step.street, step.streetPage, step.buildingPage);
      // The building's floors are not there to read: the building page again, as it is now.
      if (!floors) return back();
      const from = { saved: step.saved, street: step.street, streetPage: step.streetPage, rsn: step.rsn, buildingPage: step.buildingPage };
      if (digit === BACK) return step.page > 0 ? floorPage(world, from, floors, step.page - 1) : back();
      if (digit === MORE) return floorPage(world, from, floors, step.page + 1);
      const picked = pick(step.options, digit);
      // A floor removed since the page was sent is not saved: the page again, as it is now.
      if (picked && (picked.value === null || floors.some((floor) => floor.id === picked.value))) return { kind: "save_building", rsn: step.rsn, floorId: picked.value };
      return floorPage(world, from, floors, step.page);
    }
  }
}
