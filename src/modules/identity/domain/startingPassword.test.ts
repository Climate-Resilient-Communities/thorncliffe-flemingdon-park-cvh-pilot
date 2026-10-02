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

  it("spells the Latin part of a mixed name the same way", () => {
    expect(startingPasswordPart("Ahmad (احمد)")).toBe("ahmad");
  });

  it.each([
    ["Kɔfi", "Boateng", "rvh-kofi-boateng"],
    ["Ama", "Mɛnsah", "rvh-ama-mensah"],
    ["Ərəb", "Əliyev", "rvh-ereb-eliyev"],
    ["Ɖela", "Ƙofi", "rvh-dela-kofi"],
    ["Ɓello", "Ɗanjuma", "rvh-bello-danjuma"],
    ["Ʋivi", "Ƒiador", "rvh-vivi-fiador"],
    ["Oʻzbek", "Hawaiʻi", "rvh-ozbek-hawaii"],
    ["Ɛ", "Ɔ", "rvh-e-o"],
  ])("spells African and Azerbaijani letters: %s %s", (first, last, expected) => {
    expect(deriveStartingPassword(first, last)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ["an unmapped Latin-extended letter", "Ƣalim", "Doe"],
    ["an unmapped letter in the last name", "Jane", "Doƣ"],
    ["a native-script spelling beside the Latin one", "Ahmad (احمد)", "Doe"],
    ["a Greek letter inside a Latin name", "Jαne", "Doe"],
  ])("refuses a name whose letter would be dropped: %s", (_, first, last) => {
    expect(deriveStartingPassword(first, last)).toEqual({ ok: false, error: "starting_password_unsupported_letter" });
  });

  it("never drops a letter silently: every letter either maps to a to z or is refused", () => {
    for (let code = 0x41; code < 0x250; code += 1) {
      const letter = String.fromCodePoint(code);
      if (!/\p{L}/u.test(letter)) continue;
      const result = deriveStartingPassword(`${letter}a`, "Doe");
      if (result.ok) expect(result.value, letter).toMatch(/^rvh-[a-z]+-doe$/);
      else expect(result.error, letter).toBe("starting_password_unsupported_letter");
    }
  });

  describe("length", () => {
    // "rvh-" + first + "-" + last: 5 characters beside the two names.
    const name = (length: number) => "a".repeat(length);

    it("accepts a starting password of exactly 72 bytes", () => {
      const result = deriveStartingPassword(name(40), name(27));
      expect(result.ok && result.value.length).toBe(72);
    });

    it("refuses one of 73 bytes", () => {
      expect(deriveStartingPassword(name(40), name(28))).toEqual({ ok: false, error: "starting_password_too_long" });
    });

    it("accepts the whole of a long compound name while the password fits", () => {
      const full = "Maria del Carmen Guadalupe Fernandez de la Torre y Gutierrez de Castro";
      expect(deriveStartingPassword(full, "Ruiz")).toEqual({ ok: true, value: "rvh-mariadelcarmenguadalupefernandezdelatorreygutierrezdecastro-ruiz" });
    });

    it("refuses a very long compound name", () => {
      expect(deriveStartingPassword("Maria del Carmen Guadalupe Josefina Isabel", "Fernandez de la Torre y Gutierrez de Castro")).toEqual({
        ok: false,
        error: "starting_password_too_long",
      });
    });

    it("measures the password, not the typed name: spaces and accents do not count", () => {
      const result = deriveStartingPassword("María del Carmen", "Fernández de la Torre y Gutiérrez");
      expect(result).toEqual({ ok: true, value: "rvh-mariadelcarmen-fernandezdelatorreygutierrez" });
    });
  });
});
