import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HUB_PHONE, HUB_TEL, hasContact, phoneEntries, socialEntries, webEntry } from "./contact";

describe("the Hub's number", () => {
  it("is the number with id hub in numbers.json, read with displayPhone and dialled from the E.164 value", () => {
    const { numbers } = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "data", "catalogue", "numbers.json"), "utf8")) as { numbers: { id: string; number: string }[] };
    const hub = numbers.find((n) => n.id === "hub")!;

    expect(HUB_PHONE).toBe(hub.number);
    expect(HUB_TEL).toBe(`tel:+1${hub.number.replace(/\D/g, "")}`);
    expect(phoneEntries([HUB_PHONE])).toEqual([{ text: HUB_PHONE, tel: HUB_TEL.slice("tel:".length) }]);
  });
});

describe("phoneEntries", () => {
  it("writes a ten-digit number the way the rest of the app does, and dials it with the country code", () => {
    expect(phoneEntries(["(416)421-8997"])).toEqual([{ text: "(416) 421-8997", tel: "+14164218997" }]);
  });

  it("keeps an extension or a note beside its number", () => {
    expect(phoneEntries(["(416)363-6441 (Ext 211)"])).toEqual([{ text: "(416) 363-6441 (Ext 211)", tel: "+14163636441" }]);
  });

  it("gives one entry for each number of a line that holds several", () => {
    expect(phoneEntries(["(613)449-6705 & (647)984-8106 (Spanish)"])).toEqual([
      { text: "(613) 449-6705", tel: "+16134496705" },
      { text: "(647) 984-8106 (Spanish)", tel: "+16479848106" },
    ]);
    expect(phoneEntries(["Emergency: 911 | City: 311 | Social Services: 211"])).toEqual([
      { text: "Emergency: 911", tel: "911" },
      { text: "City: 311", tel: "311" },
      { text: "Social Services: 211", tel: "211" },
    ]);
  });

  it("shows text it cannot read as a number without a link, and skips empty lines", () => {
    expect(phoneEntries(["Ask at the front desk", "  "])).toEqual([{ text: "Ask at the front desk", tel: null }]);
  });

  it("reads every phone line of the committed catalogue as a number a phone can dial", () => {
    const catalogue = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "data", "catalogue", "providers.json"), "utf8")) as { providers: { contact: { phone: string[] } }[] };
    const lines = [...new Set(catalogue.providers.flatMap((p) => p.contact.phone))];
    expect(lines.length).toBeGreaterThan(50);
    for (const entry of lines.flatMap((line) => phoneEntries([line]))) expect(entry.tel, entry.text).toMatch(/^(\+1[2-9]\d{9}|[2-9]11)$/);
  });
});

describe("webEntry, socialEntries and hasContact", () => {
  it("shows an address without its scheme and trailing slash, and refuses anything that is not http(s)", () => {
    expect(webEntry("https://tno-toronto.org/")).toEqual({ text: "tno-toronto.org", href: "https://tno-toronto.org/" });
    expect(webEntry("https://example.org/food-bank/")?.text).toBe("example.org/food-bank");
    expect(webEntry("javascript:alert(1)")).toBeNull();
    expect(webEntry("not a url")).toBeNull();
  });

  it("splits a line of handles into one run each", () => {
    expect(socialEntries(["X @a | Facebook @b | Instagram @c"])).toEqual(["X @a", "Facebook @b", "Instagram @c"]);
  });

  it("knows when a provider lists no way to get in touch", () => {
    expect(hasContact({ phone: [], email: [], social: [], web: [] })).toBe(false);
    expect(hasContact({ phone: [], email: [" "], social: [], web: ["mailto:x"] })).toBe(false);
    expect(hasContact({ phone: [], email: ["a@example.org"], social: [], web: [] })).toBe(true);
  });
});
