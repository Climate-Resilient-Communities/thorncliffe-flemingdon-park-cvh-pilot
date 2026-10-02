import { createTranslator, type AbstractIntlMessages } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import type { Translate } from "../../residentDates";
import type { StoredBuildingContact } from "./source";
import { buildingContactCards } from "./view";

const translator = (messages: unknown, locale: string): Translate => createTranslator({ locale, messages: messages as AbstractIntlMessages }) as unknown as Translate;

const LIST: StoredBuildingContact[] = [
  { rsn: "4154146", address: "4 Milepost Pl", contact: { role: "superintendent", phone: "+14165550123", updatedAt: "2026-09-30T16:00:00Z" } },
  { rsn: "4154159", address: "85-95 Thorncliffe Park Dr", contact: null },
  { rsn: "4154170", address: "1 Overlea Blvd", contact: { role: "building_management", phone: "+14165550188", updatedAt: "2026-10-01T03:00:00Z" } },
];

describe("buildingContactCards", () => {
  it("gives a building with a contact its role, number, tel link and the Hub's label with the day it was entered", () => {
    const [card] = buildingContactCards(LIST, translator(en, "en"), "en");

    expect(card).toEqual({
      rsn: "4154146",
      address: "4 Milepost Pl",
      role: "Superintendent",
      phone: "(416) 555-0123",
      tel: "tel:+14165550123",
      provided: "Provided by the Hub, last updated September 30, 2026",
      callAria: "Call Superintendent, (416) 555-0123",
    });
  });

  it("leaves a building with no contact empty, so the page says so", () => {
    const cards = buildingContactCards(LIST, translator(en, "en"), "en");

    expect(cards[1]).toEqual({ rsn: "4154159", address: "85-95 Thorncliffe Park Dr", role: null, phone: null, tel: null, provided: null, callAria: null });
  });

  it("writes the day in Toronto, on the Gregorian calendar, in the language's way", () => {
    // 03:00 UTC on October 1 is still September 30 in Toronto.
    const cards = buildingContactCards(LIST, translator(en, "en"), "en");
    expect(cards[2].provided).toBe("Provided by the Hub, last updated September 30, 2026");
    expect(cards[2].role).toBe("Building management");

    const urdu = buildingContactCards(LIST, translator(ur, "ur"), "ur");
    expect(urdu[0].provided).toMatch(/^\[EN\] Provided by the Hub, last updated September 30, 2026$/);
    expect(urdu[0].role).toBe("[EN] Superintendent");
  });

  it("skips a role the Hub's list does not know instead of showing a made-up label", () => {
    const [card] = buildingContactCards([{ rsn: "1", address: "x", contact: { role: "janitor", phone: "+14165550123", updatedAt: "2026-09-30T16:00:00Z" } }], translator(en, "en"), "en");

    expect(card.role).toBeNull();
    expect(card.tel).toBeNull();
  });
});
