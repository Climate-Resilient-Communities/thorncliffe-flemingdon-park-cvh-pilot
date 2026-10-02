import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../i18n/messages/en.json";
import { CONTACT_ROLE_LABEL_KEYS, CONTACT_ROLES, STORED_PHONE, checkContact, displayPhone, normalizePhone, phone, telHref } from "./buildingContact";

describe("normalizePhone", () => {
  it.each([
    ["416 555 0123", "+14165550123"],
    ["(416) 555-0123", "+14165550123"],
    ["+1 416.555.0123", "+14165550123"],
    ["1-416-555-0123", "+14165550123"],
    ["  4165550123 ", "+14165550123"],
    ["+14165550123", "+14165550123"],
  ])("stores %s as %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "555-0123", "416 555 012", "016 555 0123", "416 155 0123", "416 555 0123 ext 4", "call me", "+44 20 7946 0958", "416 555 01234"])("refuses %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("only ever produces what the database check accepts", () => {
    expect(normalizePhone("(416) 555-0123")).toMatch(STORED_PHONE);
    expect(STORED_PHONE.test("416-555-0123")).toBe(false);
    expect(STORED_PHONE.test("+11165550123")).toBe(false);
  });

  it("is the same expression the migration's check uses", () => {
    const sql = readFileSync(path.join(__dirname, "..", "..", "..", "..", "db", "migrations", "20261002260000_building_contact.sql"), "utf8");
    expect(sql).toContain(`contact_phone ~ '${STORED_PHONE.source}'`);
  });
});

describe("phone (the prototype's formatter)", () => {
  it("gives any common format back as (416) 555-0123", () => {
    expect(phone("416.555.0123")).toEqual({ ok: true, digits: "4165550123", formatted: "(416) 555-0123" });
    expect(phone("+1 (416) 555-0123")).toEqual({ ok: true, digits: "4165550123", formatted: "(416) 555-0123" });
    expect(phone("+14165550123").formatted).toBe("(416) 555-0123");
  });

  it("is not ok for anything but ten digits, or eleven starting with 1", () => {
    expect(phone("555-0123")).toEqual({ ok: false, digits: "5550123", formatted: null });
    expect(phone("24165550123")).toMatchObject({ ok: false, formatted: null });
    expect(phone(null)).toEqual({ ok: false, digits: "", formatted: null });
  });
});

describe("displaying and dialling a stored number", () => {
  it("shows +14165550123 as (416) 555-0123 and dials it with the country code", () => {
    expect(displayPhone("+14165550123")).toBe("(416) 555-0123");
    expect(telHref("+14165550123")).toBe("tel:+14165550123");
  });
});

describe("the roles", () => {
  it("are the three work or office roles, each with a label in the catalog", () => {
    expect(CONTACT_ROLES).toEqual(["superintendent", "building_management", "property_office"]);
    const labels = CONTACT_ROLES.map((role) => (en.building.roles as Record<string, string>)[CONTACT_ROLE_LABEL_KEYS[role]]);
    expect(labels).toEqual(["Superintendent", "Building management", "Property office"]);
  });
});

describe("checkContact", () => {
  it("accepts a role and a number the Admin confirmed is a work or office number, storing the number as E.164", () => {
    expect(checkContact("superintendent", "(416) 555-0123", true)).toEqual({ ok: true, contact: { role: "superintendent", phone: "+14165550123" } });
  });

  it("refuses a number that was not confirmed as a work or office number", () => {
    expect(checkContact("superintendent", "416 555 0123", false)).toEqual({ ok: false, error: "not_work_number" });
  });

  it("removes the contact when both are empty, with or without the confirmation", () => {
    expect(checkContact("  ", "", false)).toEqual({ ok: true, contact: null });
  });

  it("refuses one without the other, with the reason", () => {
    expect(checkContact("superintendent", " ", true)).toEqual({ ok: false, error: "role_without_phone" });
    expect(checkContact("", "416 555 0123", true)).toEqual({ ok: false, error: "phone_without_role" });
  });

  it("refuses a role that is not on the list, such as free text or a personal name", () => {
    expect(checkContact("Superintendent", "416 555 0123", true)).toEqual({ ok: false, error: "role_invalid" });
    expect(checkContact("Ahmed Khan", "416 555 0123", true)).toEqual({ ok: false, error: "role_invalid" });
  });

  it("refuses a number that is not a North American one", () => {
    expect(checkContact("property_office", "555-0123", true)).toEqual({ ok: false, error: "phone_invalid" });
  });
});
