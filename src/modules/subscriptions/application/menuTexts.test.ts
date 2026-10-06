// The one-segment fixture of the menus and prompts (S07.05, AR-19, AD-21): every menu and prompt text in every launch language renders to
// exactly one segment with messaging's real encoder (GSM-7 or UCS-2, the body sent byte for byte with SmartEncoded=false), or this fails
// naming the text and the language. The pages are the real ones: the 43 pilot buildings of the committed City register by street, each
// building's floors as the seed makes them (1 to its storeys, unconfirmed), floors with the longest labels an Admin may give, and the 15
// languages; every page of every list is walked with the menus' own moves (a page that cannot fit one option fails naming its catalog
// strings and the language). The fixed texts are filled with their longest values, and each page's own strings (its title, the reserved
// replies, "Whole building") are checked on their own too, with the two options of its list that make the longest page: a page holds at
// least 2 options in every language, and a string too long for that fails here by name.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LAUNCH_CODES, LAUNCH_LANGUAGES, type LaunchCode } from "../../../i18n/languages";
import { residentText, type ResidentTextName } from "../../../i18n/residentTexts";
import { countSms, normaliseSms } from "../../messaging";
import { FLOOR_LABEL_MAX_LENGTH, planBuildingImport, readMergeFile, readRegisterFile, streetOf } from "../../places";
import {
  HUB_NUMBER,
  MORE,
  OPTIONS_PER_PAGE,
  answerMenu,
  buildingsOn,
  pageName,
  pageText,
  startBuildingMenu,
  startLanguageMenu,
  streetsOf,
  type Menu,
  type MenuBuilding,
  type MenuFloor,
  type MenuMove,
  type MenuWorld,
} from "../domain/menus";
import { fitsOneText } from "./menus";

const ROOT = path.resolve(__dirname, "../../../..");
const plan = planBuildingImport(readRegisterFile(path.join(ROOT, "data", "seed", "apartment_building_reg.geojson")), readMergeFile(path.join(ROOT, "data", "seed", "building-merge.csv")).entries);
const BUILDINGS: MenuBuilding[] = plan.buildings.map((building) => ({ rsn: building.rsn, address: building.address, neighbourhoodId: building.neighbourhoodId, ...streetOf(building.address) }));
const floorId = (rsn: string, n: number) => `0190f000-0000-7000-8000-${rsn.padStart(9, "0")}${String(n).padStart(3, "0")}`;
/** The floors the seed makes: 1 to the register's storeys, labelled by number. */
const SEEDED = new Map<string, MenuFloor[]>(plan.buildings.map((building) => [building.rsn, Array.from({ length: building.storeys ?? 0 }, (_, index) => ({ id: floorId(building.rsn, index + 1), label: String(index + 1) }))]));
/** The same buildings with every floor labelled as long as a label may be ("PH-LEVEL", 8 characters). */
const LONGEST = new Map<string, MenuFloor[]>([...SEEDED].map(([rsn, floors]) => [rsn, floors.map((floor, index) => ({ ...floor, label: `PH-L${String(index).padStart(4, "0")}`.slice(0, FLOOR_LABEL_MAX_LENGTH) }))]));

/** The longest values the texts are filled with: an address, a floor label, the Hub's number, a count of saved buildings. */
const LONGEST_ADDRESS = BUILDINGS.map((building) => building.address).sort((a, b) => b.length - a.length)[0]!;
const FILL = { building: LONGEST_ADDRESS, floor: "PH-LEVEL", hub: HUB_NUMBER, n: String(BUILDINGS.length) };

/** Every menu and prompt text the inbound router and the menus send, with the values it is sent with (S07.04's prompts included). */
const PROMPT_TEXTS: ResidentTextName[] = [
  "menuWarn",
  "menuHub",
  "menuClosed",
  "menuReset",
  "menuLimit",
  "menuLimitLink",
  "buildingSaved",
  "buildingSavedWhole",
  "languageSaved",
  "noCheckinRequest",
  "checkinWithdrawn",
  "deletePrompt",
  "alreadySignedUp",
];

/** The text as it is sent, its segments counted by messaging's encoder. */
const count = (text: string) => countSms(normaliseSms(text));

function expectOneSegment(text: string, what: string, lang: LaunchCode) {
  const counted = count(text);
  expect(counted.segments, `${what} in ${lang} is ${counted.segments} segments (${counted.encoding}, ${counted.units} units): ${JSON.stringify(normaliseSms(text))}`).toBe(1);
}

const pageOf = (move: MenuMove): Extract<MenuMove, { kind: "show" }> => {
  if (move.kind !== "show") throw new Error(`expected a page, got ${move.kind}`);
  return move;
};

/** Every page of the list `first` opens, by pressing 8 until the page no longer changes. */
function allPages(first: MenuMove, world: MenuWorld): Extract<MenuMove, { kind: "show" }>[] {
  const pages = [pageOf(first)];
  for (;;) {
    const last = pages.at(-1)!;
    const next = pageOf(answerMenu(last.menu, MORE, world));
    if (JSON.stringify(next.menu) === JSON.stringify(last.menu)) return pages;
    pages.push(next);
  }
}

const optionsOf = (menu: Menu) => (menu.kind === "menu_language" ? menu.step.options : "options" in menu.step ? menu.step.options : []);

describe("the menus' one-segment fixture (every menu and prompt text, every language, the real encoder)", () => {
  it("renders every prompt and reply of the menus, filled with its longest values, to one segment", () => {
    for (const lang of LAUNCH_CODES) {
      for (const name of PROMPT_TEXTS) expectOneSegment(residentText(lang, name, FILL), name, lang);
    }
  });

  it("fits each page's own strings (its title, menuNavMore, Whole building) with the two options of its list that make the longest page", () => {
    /** Every label a page of each title may show: the streets, the buildings' numbers, the floors (Whole building, the longest label), the languages. */
    const lists = (lang: LaunchCode): [ResidentTextName, string[]][] => [
      ["menuStreet", streetsOf(BUILDINGS)],
      ["menuBuilding", streetsOf(BUILDINGS).flatMap((street) => buildingsOn(BUILDINGS, street).map((item) => item.label))],
      ["menuFloor", [residentText(lang, "menuWholeBuilding"), "PH-LEVEL", ...[...SEEDED.values()].flat().map((floor) => floor.label)]],
      ["menuLanguage", LAUNCH_LANGUAGES.map((language) => language.native)],
    ];
    for (const lang of LAUNCH_CODES) {
      for (const [title, labels] of lists(lang)) {
        const distinct = [...new Set(labels)];
        let longest = { size: -1, text: "" };
        for (const a of distinct) {
          for (const b of distinct) {
            if (a === b) continue;
            const text = pageText(lang, title, [a, b], true);
            const counted = count(text);
            const size = counted.segments * 10_000 + counted.units;
            if (size > longest.size) longest = { size, text };
          }
        }
        expectOneSegment(longest.text, `${pageName(title, lang).replace(` in ${lang}`, "")} with its two longest options`, lang);
      }
    }
  });

  it("renders every page of menu 1 for the 43 pilot buildings, with the seeded floors and the longest labels, to one segment of 1 to 7 options", () => {
    expect(BUILDINGS).toHaveLength(43);
    for (const lang of LAUNCH_CODES) {
      for (const floors of [SEEDED, LONGEST]) {
        const world: MenuWorld = { lang, buildings: BUILDINGS, floors, fits: fitsOneText };
        let buildingsSeen = 0;
        const check = (page: Extract<MenuMove, { kind: "show" }>, what: string) => {
          expectOneSegment(page.text, what, lang);
          expect(optionsOf(page.menu).length, `${what} in ${lang}`).toBeGreaterThanOrEqual(1);
          expect(optionsOf(page.menu).length, `${what} in ${lang}`).toBeLessThanOrEqual(OPTIONS_PER_PAGE);
        };
        expectOneSegment(pageOf(startBuildingMenu(world, 2)).text, "the warning (menuWarn)", lang);
        for (const streets of allPages(startBuildingMenu(world, 1), world)) {
          check(streets, "a street page");
          for (let pick = 1; pick <= optionsOf(streets.menu).length; pick += 1) {
            for (const buildings of allPages(answerMenu(streets.menu, pick, world), world)) {
              check(buildings, `a building page of ${String(optionsOf(streets.menu)[pick - 1])}`);
              for (let choice = 1; choice <= optionsOf(buildings.menu).length; choice += 1) {
                buildingsSeen += 1;
                const rsn = String(optionsOf(buildings.menu)[choice - 1]);
                const next = answerMenu(buildings.menu, choice, world);
                if (next.kind === "save_building") continue;
                for (const floorPage of allPages(next, world)) check(floorPage, `a floor page of ${rsn}`);
              }
            }
          }
        }
        // Every building is reached by exactly one street and one number.
        expect(buildingsSeen, lang).toBe(43);
      }
    }
  });

  it("renders every page of menu 2, the 15 languages each in its own name, to one segment, and lists each language once", () => {
    for (const lang of LAUNCH_CODES) {
      const world: MenuWorld = { lang, buildings: [], floors: new Map(), fits: fitsOneText };
      const pages = allPages(startLanguageMenu(world), world);
      for (const page of pages) expectOneSegment(page.text, "a language page", lang);
      expect(pages.flatMap((page) => optionsOf(page.menu)), lang).toEqual([...LAUNCH_CODES]);
    }
  });

  it("is a real check: a text one character over the limit is two segments", () => {
    expect(count("a".repeat(160)).segments).toBe(1);
    expect(count("a".repeat(161)).segments).toBe(2);
    expect(count("ا".repeat(70)).segments).toBe(1);
    expect(count("ا".repeat(71)).segments).toBe(2);
    expect(fitsOneText("ا".repeat(71))).toBe(false);
  });
});
