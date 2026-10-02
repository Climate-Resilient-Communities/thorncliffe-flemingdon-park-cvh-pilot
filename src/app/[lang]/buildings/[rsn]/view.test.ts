import { createTranslator, type AbstractIntlMessages } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import type { PublicBuilding } from "@/modules/places";
import { buildingPageView, formatDay, type Translate } from "./view";

const translator = (messages: unknown, locale: string): Translate => createTranslator({ locale, messages: messages as AbstractIntlMessages }) as unknown as Translate;

const building = (change: Partial<PublicBuilding> = {}): PublicBuilding => ({
  rsn: "4154146",
  address: "4 Milepost Pl",
  neighbourhoodName: "Thorncliffe Park",
  storeys: 14,
  elevators: 2,
  emergencyPower: true,
  coolingRoom: false,
  airConditioning: "None",
  barrierFreeEntrance: null,
  factsUpdatedAt: new Date("2026-09-28T12:00:00Z"),
  checkingDetails: false,
  contact: null,
  ...change,
});

describe("the building page view", () => {
  const t = translator(en, "en");

  it("lists the six register facts in order, with the day they last changed", () => {
    const view = buildingPageView(building(), t, "en");

    expect(view.facts.map((fact) => [fact.id, fact.label, fact.value.kind, fact.value.text])).toEqual([
      ["storeys", "Storeys", "number", "14"],
      ["elevators", "Elevators", "number", "2"],
      ["emergencyPower", "Emergency power", "yes", "Yes"],
      ["coolingRoom", "Cooling room", "no", "No"],
      ["airConditioning", "Air conditioning", "register", "None"],
      ["barrierFree", "Barrier-free entrance", "unknown", "Not known"],
    ]);
    expect(view.updated).toBe("Last updated September 28, 2026");
  });

  it("never shows a missing fact as No: every missing fact is Not known, and Not known is its own kind", () => {
    const view = buildingPageView(
      building({ storeys: null, elevators: null, emergencyPower: null, coolingRoom: null, airConditioning: null, barrierFreeEntrance: null }),
      t,
      "en",
    );

    expect(view.facts.map((fact) => [fact.value.kind, fact.value.text])).toEqual(Array(6).fill(["unknown", "Not known"]));
    const no = buildingPageView(building({ emergencyPower: false }), t, "en").facts[2].value;
    expect(no).toEqual({ kind: "no", text: "No" });
  });

  it("shows zero elevators as 0, not as Not known", () => {
    expect(buildingPageView(building({ elevators: 0 }), t, "en").facts[1].value).toEqual({ kind: "number", text: "0" });
  });

  it("keeps the register's own words for an air conditioning type it does not translate", () => {
    expect(buildingPageView(building({ airConditioning: "Central air" }), t, "en").facts[4].value).toEqual({ kind: "register", text: "Central air", english: true });
    expect(buildingPageView(building({ airConditioning: "INDIVIDUAL UNITS" }), t, "en").facts[4].value).toEqual({ kind: "register", text: "Individual units", english: false });
  });

  it("notes that the Hub is checking a building the latest register does not list, and only then", () => {
    expect(buildingPageView(building(), t, "en").checking).toBeNull();
    expect(buildingPageView(building({ checkingDetails: true }), t, "en").checking).toBe("The Hub is checking this building's details. What you see here may change.");
  });

  it("labels the Hub's contact with its owner and last-updated date; with none it reads Not known", () => {
    const none = buildingPageView(building(), t, "en").contact;
    expect(none).toMatchObject({ provided: null, role: null, phone: null, telHref: null, none: "Not known" });

    const some = buildingPageView(building({ contact: { role: "Superintendent", phone: "416-555-0123", owner: "hub", updatedAt: new Date("2026-10-01T15:00:00Z") } }), t, "en").contact;
    expect(some).toMatchObject({ provided: "Provided by the Hub, last updated October 1, 2026", role: "Superintendent", phone: "416-555-0123", telHref: "tel:+14165550123" });
  });

  it("writes a day as it was in Toronto, whatever the server's time zone", () => {
    expect(formatDay(new Date("2026-10-02T02:30:00Z"), "en")).toBe("October 1, 2026");
  });

  it("falls back to English for text a language lacks, with the date written the English way", () => {
    const view = buildingPageView(building(), translator(ur, "ur"), "ur");

    expect(view.registerTitle).toBe("[EN] From the City register");
    expect(view.updated).toBe("[EN] Last updated September 28, 2026");
    // Yes, No and Not known have their own translations.
    expect(view.facts[2].value.text).not.toMatch(/^\[EN\]/);
    expect(view.facts[5].value.text).not.toMatch(/^\[EN\]/);
    expect(view.facts[5].value.text).not.toBe(view.facts[3].value.text);
  });
});
