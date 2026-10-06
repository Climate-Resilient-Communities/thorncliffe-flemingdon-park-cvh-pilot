import { describe, expect, it } from "vitest";
import { LAUNCH_LANGUAGES } from "../../../i18n/languages";
import { residentText } from "../../../i18n/residentTexts";
import {
  BACK,
  HUB,
  HUB_NUMBER,
  MORE,
  MenuPageTooLong,
  answerMenu,
  buildingsOn,
  floorsWanted,
  menuDigit,
  openPromptOf,
  pageText,
  paginate,
  readMenu,
  startBuildingMenu,
  startLanguageMenu,
  streetsOf,
  type Menu,
  type MenuBuilding,
  type MenuFloor,
  type MenuMove,
  type MenuWorld,
} from "./menus";

const building = (rsn: string, number: string | null, street: string, neighbourhoodId = "TP"): MenuBuilding => ({
  rsn,
  number,
  street,
  address: number === null ? street : `${number} ${street}`,
  neighbourhoodId,
});

// Nine buildings on Thorncliffe Park Dr (two pages of seven at most), two on Milepost Pl, one on Gateway Blvd.
const BUILDINGS: MenuBuilding[] = [
  building("101", "85-95", "Thorncliffe Park Dr"),
  building("102", "12", "Thorncliffe Park Dr"),
  building("103", "2", "Thorncliffe Park Dr"),
  ...["18", "22", "23", "26", "27", "35"].map((number, index) => building(String(110 + index), number, "Thorncliffe Park Dr")),
  building("201", "4", "Milepost Pl"),
  building("202", "2", "Milepost Pl"),
  building("301", "200", "Gateway Blvd", "FP"),
];
const floorId = (n: number) => `0190f000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const FLOORS: MenuFloor[] = Array.from({ length: 10 }, (_, index) => ({ id: floorId(index + 1), label: String(index + 1) }));

/** A world where every page holds as many options as the rule allows (the encoder is tested in menuTexts.test.ts). */
const world = (over: Partial<MenuWorld> = {}): MenuWorld => ({ lang: "en", buildings: BUILDINGS, floors: new Map(), fits: () => true, ...over });

const shown = (move: MenuMove) => {
  if (move.kind !== "show") throw new Error(`expected a page, got ${move.kind}`);
  return move;
};

describe("a menu's reply", () => {
  it("is one digit 0 to 9, in any script; anything else is none", () => {
    expect(["0", "1", "7", "8", "9"].map(menuDigit)).toEqual([0, 1, 7, 8, 9]);
    expect(["۸", "৯", "૭", "０", " 3. "].map(menuDigit)).toEqual([8, 9, 7, 0, 3]);
    for (const body of ["10", "", "yes", "1 2", "eight"]) expect(menuDigit(body), body).toBeNull();
  });
});

describe("the lists", () => {
  it("put the street with most buildings first, then by name", () => {
    expect(streetsOf(BUILDINGS)).toEqual(["Thorncliffe Park Dr", "Milepost Pl", "Gateway Blvd"]);
  });

  it("name a street's buildings by their number, in numeric order", () => {
    expect(buildingsOn(BUILDINGS, "Thorncliffe Park Dr").map((item) => item.label)).toEqual(["2", "12", "18", "22", "23", "26", "27", "35", "85-95"]);
    expect(buildingsOn(BUILDINGS, "Milepost Pl")).toEqual([
      { value: "202", label: "2" },
      { value: "201", label: "4" },
    ]);
    expect(buildingsOn([building("9", null, "Overlea Blvd")], "Overlea Blvd")).toEqual([{ value: "9", label: "Overlea Blvd" }]);
  });
});

describe("pages", () => {
  it("number their options 1 to 7 under the title, with 0, 9 and 8 only when there is a next page", () => {
    expect(pageText("en", "menuStreet", ["A St", "B St"], true)).toBe("Your street:\n1) A St\n2) B St\n0 Back 8 More 9 Hub");
    expect(pageText("en", "menuStreet", ["A St"], false)).toBe("Your street:\n1) A St\n0 Back 9 Hub");
  });

  it("hold at most 7 options, and as many as fit one text", () => {
    const items = Array.from({ length: 16 }, (_, index) => index);
    expect(paginate(items, () => "x", () => true).map((page) => page.length)).toEqual([7, 7, 2]);
    // A text that fits three options when it offers 8 More, and four on the last page.
    const fits = (count: number, more: boolean) => count <= (more ? 3 : 4);
    expect(paginate(items.slice(0, 7), (page, more) => `${page.length}:${more}`, (text) => fits(Number(text.split(":")[0]), text.endsWith("true"))).map((p) => p.length)).toEqual([3, 4]);
  });

  it("refuse a list whose single option does not fit with the page's title and replies", () => {
    expect(() => paginate([1], () => "too long", () => false)).toThrow(MenuPageTooLong);
    expect(paginate([], () => "", () => true)).toEqual([]);
  });
});

describe("menu 1 (building or floor)", () => {
  it("starts with the streets when one building or none is saved, and with the warning when more are", () => {
    const streets = shown(startBuildingMenu(world(), 1));
    expect(streets.menu).toEqual({ kind: "menu_building", step: { stage: "street", saved: 1, page: 0, options: ["Thorncliffe Park Dr", "Milepost Pl", "Gateway Blvd"] } });
    expect(streets.text).toBe("Your street:\n1) Thorncliffe Park Dr\n2) Milepost Pl\n3) Gateway Blvd\n0 Back 9 Hub");
    expect(shown(startBuildingMenu(world(), 0)).menu.step).toMatchObject({ stage: "street", saved: 0 });

    const warning = shown(startBuildingMenu(world(), 3));
    expect(warning.menu).toEqual({ kind: "menu_building", step: { stage: "warn", saved: 3 } });
    expect(warning.text).toBe("This replaces your 3 saved buildings. 1 Continue, 0 Back");
  });

  it("goes from the warning to the streets on 1, closes on 0, and shows the warning again on anything else", () => {
    const warn: Menu = { kind: "menu_building", step: { stage: "warn", saved: 2 } };
    expect(shown(answerMenu(warn, 1, world())).menu.step).toMatchObject({ stage: "street", saved: 2, page: 0 });
    expect(answerMenu(warn, BACK, world())).toEqual({ kind: "close" });
    expect(shown(answerMenu(warn, 2, world())).menu).toEqual(warn);
    expect(shown(answerMenu(warn, null, world())).menu).toEqual(warn);
    expect(answerMenu(warn, HUB, world())).toEqual({ kind: "hub" });
  });

  it("goes street -> buildings on it -> floors, and 0 goes back a page, then a step, then to the warning or out", () => {
    const streets = shown(startBuildingMenu(world(), 2 - 1));
    const tpd = shown(answerMenu(streets.menu, 1, world()));
    expect(tpd.menu.step).toEqual({ stage: "building", saved: 1, street: "Thorncliffe Park Dr", streetPage: 0, page: 0, options: ["103", "102", "110", "111", "112", "113", "114"] });
    expect(tpd.text).toBe("Your building:\n1) 2\n2) 12\n3) 18\n4) 22\n5) 23\n6) 26\n7) 27\n0 Back 8 More 9 Hub");

    // 8: the next page, the last, which offers no 8; an 8 there shows it again.
    const more = shown(answerMenu(tpd.menu, MORE, world()));
    expect(more.menu.step).toMatchObject({ stage: "building", page: 1, options: ["115", "101"] });
    expect(more.text).toBe("Your building:\n1) 35\n2) 85-95\n0 Back 9 Hub");
    expect(shown(answerMenu(more.menu, MORE, world())).menu).toEqual(more.menu);
    // 0: the page before, then the streets.
    expect(shown(answerMenu(more.menu, BACK, world())).menu).toEqual(tpd.menu);
    expect(shown(answerMenu(tpd.menu, BACK, world())).menu).toEqual(streets.menu);
    expect(answerMenu(streets.menu, BACK, world())).toEqual({ kind: "close" });

    // A building: its floors are read (floorsWanted), and its floor page has the whole building first.
    expect(floorsWanted(more.menu, 2)).toEqual(["101"]);
    expect(floorsWanted(more.menu, 5)).toEqual([]);
    const floorsWorld = world({ floors: new Map([["101", FLOORS]]) });
    const floors = shown(answerMenu(more.menu, 2, floorsWorld));
    expect(floors.menu.step).toEqual({
      stage: "floor",
      saved: 1,
      street: "Thorncliffe Park Dr",
      streetPage: 0,
      rsn: "101",
      buildingPage: 1,
      page: 0,
      options: [null, floorId(1), floorId(2), floorId(3), floorId(4), floorId(5), floorId(6)],
    });
    expect(floors.text).toBe("Your floor:\n1) Whole building\n2) 1\n3) 2\n4) 3\n5) 4\n6) 5\n7) 6\n0 Back 8 More 9 Hub");
    expect(floorsWanted(floors.menu, null)).toEqual(["101"]);
    // 0 on the first floor page: the building page it came from.
    expect(shown(answerMenu(floors.menu, BACK, floorsWorld)).menu).toEqual(more.menu);
    const lastFloors = shown(answerMenu(floors.menu, MORE, floorsWorld));
    expect(lastFloors.menu.step).toMatchObject({ page: 1, options: [floorId(7), floorId(8), floorId(9), floorId(10)] });

    // The last step: a floor, or the whole building (no floor).
    expect(answerMenu(lastFloors.menu, 4, floorsWorld)).toEqual({ kind: "save_building", rsn: "101", floorId: floorId(10) });
    expect(answerMenu(floors.menu, 1, floorsWorld)).toEqual({ kind: "save_building", rsn: "101", floorId: null });
  });

  it("goes back from the first street page to the warning when it was shown", () => {
    const street: Menu = { kind: "menu_building", step: { stage: "street", saved: 4, page: 0, options: ["Thorncliffe Park Dr"] } };
    expect(shown(answerMenu(street, BACK, world())).menu).toEqual({ kind: "menu_building", step: { stage: "warn", saved: 4 } });
  });

  it("saves a building that has no floors at once, with no floor", () => {
    const gateway = shown(answerMenu(shown(startBuildingMenu(world(), 0)).menu, 3, world()));
    expect(answerMenu(gateway.menu, 1, world({ floors: new Map([["301", []]]) }))).toEqual({ kind: "save_building", rsn: "301", floorId: null });
  });

  it("sends the page again for a digit that is not an option, a reply that is not a digit, or a floor removed since", () => {
    const streets = shown(startBuildingMenu(world(), 0));
    for (const digit of [4, 5, 6, 7, null]) expect(shown(answerMenu(streets.menu, digit, world())).menu, String(digit)).toEqual(streets.menu);
    const floorsWorld = world({ floors: new Map([["202", FLOORS.slice(0, 2)]]) });
    const floors = shown(answerMenu({ kind: "menu_building", step: { stage: "building", saved: 0, street: "Milepost Pl", streetPage: 0, page: 0, options: ["202", "201"] } }, 1, floorsWorld));
    // Floor 2 is removed by an Admin before the reply: the page is sent again as it now is.
    const removed = world({ floors: new Map([["202", FLOORS.slice(0, 1)]]) });
    const again = shown(answerMenu(floors.menu, 3, removed));
    expect(again.menu.step).toMatchObject({ stage: "floor", options: [null, floorId(1)] });
    // The building's floors could not be read at all: the building page again.
    expect(shown(answerMenu(floors.menu, 2, world())).menu.step).toMatchObject({ stage: "building", street: "Milepost Pl" });
  });

  it("gives the Hub's number on 9 at every step", () => {
    const streets = shown(startBuildingMenu(world(), 0));
    expect(answerMenu(streets.menu, HUB, world())).toEqual({ kind: "hub" });
    expect(HUB_NUMBER).toBe("(416) 421-8997");
  });
});

describe("menu 2 (language)", () => {
  it("lists the 15 languages each in its own name, 7 a page at most, and saves the one picked", () => {
    const first = shown(startLanguageMenu(world()));
    expect(first.menu).toEqual({ kind: "menu_language", step: { stage: "language", page: 0, options: ["ur", "ps", "tl", "prs", "gu", "ta", "el"] } });
    expect(first.text.split("\n")).toEqual(["Your language:", "1) اردو", "2) پښتو", "3) Tagalog", "4) دری", "5) ગુજરાતી", "6) தமிழ்", "7) Ελληνικά", "0 Back 8 More 9 Hub"]);
    const second = shown(answerMenu(first.menu, MORE, world()));
    const third = shown(answerMenu(second.menu, MORE, world()));
    const optionsOf = (menu: Menu) => (menu.kind === "menu_language" ? menu.step.options : []);
    expect([first, second, third].flatMap((page) => optionsOf(page.menu))).toEqual(LAUNCH_LANGUAGES.map((language) => language.code));
    expect(third.text).toBe("Your language:\n1) English\n0 Back 9 Hub");
    expect(answerMenu(third.menu, 1, world())).toEqual({ kind: "save_language", lang: "en" });
    expect(answerMenu(first.menu, 4, world())).toEqual({ kind: "save_language", lang: "prs" });
    expect(shown(answerMenu(third.menu, BACK, world())).menu).toEqual(second.menu);
    expect(answerMenu(first.menu, BACK, world())).toEqual({ kind: "close" });
    expect(shown(answerMenu(third.menu, 2, world())).menu).toEqual(third.menu);
    expect(floorsWanted(first.menu, 1)).toEqual([]);
  });

  it("is titled in the subscriber's language", () => {
    expect(shown(startLanguageMenu(world({ lang: "fr" }))).text.startsWith(residentText("fr", "menuLanguage"))).toBe(true);
  });
});

describe("the step kept in sms_prompt", () => {
  it("is read back as the menu it was written from", () => {
    const menu = shown(startBuildingMenu(world(), 0)).menu;
    expect(readMenu(menu.kind, JSON.parse(JSON.stringify(menu.step)))).toEqual(menu);
    const language = shown(startLanguageMenu(world())).menu;
    expect(readMenu(language.kind, JSON.parse(JSON.stringify(language.step)))).toEqual(language);
  });

  it("is not a menu when its kind or shape is not one", () => {
    expect(readMenu("delete_confirm", {})).toBeNull();
    expect(readMenu("menu_building", {})).toBeNull();
    expect(readMenu("menu_building", { stage: "street", saved: 0, page: 0, options: [] })).toBeNull();
    expect(readMenu("menu_language", { stage: "language", page: 0, options: ["xx"] })).toBeNull();
    expect(readMenu("menu_language", { stage: "language", page: 0, options: ["en"], extra: true })).toBeNull();
  });

  it("is the open prompt the decision table reads: a menu, a menu idle 10 minutes, the deletion's confirmation, the edit link's offer", () => {
    expect(openPromptOf(null)).toBe("none");
    expect(openPromptOf({ kind: "delete_confirm", idle: false })).toBe("delete_confirm");
    expect(openPromptOf({ kind: "menu_building", idle: false })).toBe("menu");
    expect(openPromptOf({ kind: "menu_language", idle: true })).toBe("menu_idle");
    expect(openPromptOf({ kind: "edit_link_offer", idle: false })).toBe("edit_link_offer");
    expect(openPromptOf({ kind: "something_else", idle: false })).toBe("none");
  });
});
