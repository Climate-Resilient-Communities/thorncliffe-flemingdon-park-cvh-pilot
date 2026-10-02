import { describe, expect, it } from "vitest";
import { deriveStartingPassword, startingPasswordPart } from "./startingPassword";

describe("starting password", () => {
  it("is rvh-firstname-lastname in lower case", () => {
    expect(deriveStartingPassword("Jane", "Doe")).toEqual({ ok: true, value: "rvh-jane-doe" });
  });

  it.each([
    ["accents are stripped", "José", "Muñoz", "rvh-jose-munoz"],
    ["stacked diacritics are stripped", "Nguyễn", "Thị Ánh", "rvh-nguyen-thianh"],
    ["spaces inside a name are removed", "Mary Ann", "Van der Berg", "rvh-maryann-vanderberg"],
    ["apostrophes are removed", "D'Arcy", "O'Brien", "rvh-darcy-obrien"],
    ["typographic apostrophes are removed", "Ngā", "O’Neil", "rvh-nga-oneil"],
    ["hyphens are removed, so the password's own hyphens stay separators", "Jean-Luc", "Al-Hassan", "rvh-jeanluc-alhassan"],
    ["dots and digits are removed", "J.", "Smith 3rd", "rvh-j-smithrd"],
    ["Latin letters that do not decompose are spelled out", "Søren", "Łukasz-Straße", "rvh-soren-lukaszstrasse"],
    ["ligatures and Nordic letters", "Ægir", "Þórsdóttir", "rvh-aegir-thorsdottir"],
    ["Turkish dotted and dotless i", "İlkay", "Yıldız", "rvh-ilkay-yildiz"],
    ["full-width letters", "Ａｎｎ", "Ｌｅｅ", "rvh-ann-lee"],
    ["leading and trailing spaces", "  Ali ", " Khan  ", "rvh-ali-khan"],
  ])("%s", (_, first, last, expected) => {
    expect(deriveStartingPassword(first, last)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ["only symbols", "!!!", "Doe"],
    ["a last name of only symbols", "Jane", "--"],
    ["a name in Arabic script", "فاطمة", "Doe"],
    ["a name in Bengali script", "Jane", "রহমান"],
    ["a name in Chinese", "王", "芳"],
    ["a name in Greek", "Ελένη", "Παπαδοπούλου"],
    ["blank names", " ", ""],
  ])("refuses names that reduce to nothing: %s", (_, first, last) => {
    expect(deriveStartingPassword(first, last)).toEqual({ ok: false, error: "starting_password_empty" });
  });

  it("keeps the Latin letters of a mixed name", () => {
    expect(startingPasswordPart("Ahmad (احمد)")).toBe("ahmad");
  });
});
