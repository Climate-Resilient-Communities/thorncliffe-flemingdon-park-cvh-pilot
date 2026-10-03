import { describe, expect, it } from "vitest";
import { lostFacts, toWesternDigits, weekdays } from "./translationFacts";

const ENGLISH = "Open Mon-Fri 9:30 a.m.-4:30 p.m. at 30 Thorncliffe Park Dr, M4H 1L1. Call 416-421-0792 or email info@example.org; see https://example.org/help.";
const URDU = "پیر تا جمعہ 9:30 a.m.-4:30 p.m. کھلا، 30 Thorncliffe Park Dr, M4H 1L1۔ 416-421-0792 پر کال کریں یا info@example.org پر ای میل کریں؛ https://example.org/help دیکھیں۔";

// The real fire-station description of data/catalogue/providers.json (M002 to M006) and its Pashto machine translation.
const FIRE = "Toronto Fire Services stations providing 24/7 fire protection and emergency rescue for the area: Station 321 (231 McRae Dr), Station 235 (200 Bermondsey Rd), Station 322 (256 Cosburn Ave), Station 224 (1313 Woodbine Ave). Non-emergency line: 416-338-9050.";
const FIRE_PS =
  "د Toronto Fire Services مرکزونه چې د دې سیمې لپاره 24/7 د اور څخه ساتنه او بیړنۍ ژغورنه وړاندې کوي: Station 321 (231 McRae Dr)، Station 235 (200 Bermondsey Rd)، Station 322 (256 Cosburn Ave)، Station 224 (1313 Woodbine Ave). غیر عاجل تلیفون شمېره: 416-338-9050.";

describe("lostFacts: what an unreviewed machine translation must keep (AD-11 pilot change)", () => {
  it("finds nothing when every fact survives, in order", () => {
    expect(lostFacts(ENGLISH, URDU, "ur")).toEqual([]);
    expect(lostFacts(FIRE, FIRE_PS, "ps")).toEqual([]);
  });

  it("accepts the same facts in another script's digits, with invisible direction marks", () => {
    expect(toWesternDigits("۴۱۶-۴۲۱-۰۷۹۲ ٣٠ १२")).toBe("416-421-0792 30 12");
    const native = URDU.replace("416-421-0792", "‎۴۱۶-۴۲۱-۰۷۹۲‎").replace("30 Thorncliffe", "۳۰​ Thorncliffe");
    expect(lostFacts(ENGLISH, native, "ur")).toEqual([]);
  });

  describe("order and counts", () => {
    it("refuses two numbers swapped: the real fire-station text, Station 321 (231 McRae Dr) as Station 231 (321 McRae Dr)", () => {
      const swapped = FIRE_PS.replace("Station 321 (231 McRae Dr)", "Station 231 (321 McRae Dr)");
      expect(lostFacts(FIRE, swapped, "ps")).toEqual([expect.stringMatching(/^numbers 24 7 321 231 /)]);
    });

    it("refuses two phone numbers swapped", () => {
      const english = "Food bank 416-555-0101; clinic 416-555-0202.";
      expect(lostFacts(english, "Banco de alimentos 416-555-0202; clínica 416-555-0101.", "es")).not.toEqual([]);
      expect(lostFacts(english, "Banco de alimentos 416-555-0101; clínica 416-555-0202.", "es")).toEqual([]);
    });

    it("refuses one copy of a repeated number dropped", () => {
      const english = "Room 12 on floor 3; overflow in room 12.";
      expect(lostFacts(english, "Salle 12 au 3e étage; débordement dans la même salle.", "fr")).toEqual([expect.stringMatching(/^numbers 12 3 12 /)]);
    });

    it("refuses a number the English does not have", () => {
      expect(lostFacts("Free groceries.", "Épicerie gratuite, 24/7.", "fr")).not.toEqual([]);
    });
  });

  describe("times", () => {
    it("refuses a.m. and p.m. swapped: 9:00 am to 5:00 pm as 9:00 pm to 5:00 am", () => {
      const english = "Open 9:00 am to 5:00 pm.";
      expect(lostFacts(english, "Abierto de 9:00 pm a 5:00 am.", "es")).toEqual([expect.stringMatching(/^times /)]);
      expect(lostFacts(english, "Abierto de 9:00 am a 5:00 pm.", "es")).toEqual([]);
    });

    it("accepts an unambiguous 24-hour time for an a.m./p.m. one, and the French 'h' form", () => {
      expect(lostFacts("Mon-Thu 8:45am-1:45pm.", "Lun-jeu, 8 h 45 à 13 h 45.", "fr")).toEqual([expect.stringMatching(/^weekdays/)]);
      expect(lostFacts("Monday to Thursday 8:45am-1:45pm.", "Du lundi au jeudi, de 8 h 45 à 13 h 45.", "fr")).toEqual([]);
      expect(lostFacts("Open until 9pm.", "Abierto hasta las 21:00.", "es")).toEqual([]);
    });

    it("refuses an a.m./p.m. time given without a.m./p.m. where the 24-hour reading is ambiguous (local words are not read)", () => {
      expect(lostFacts("Open 9:00 AM to 5:00 PM.", "صبح 9:00 سے شام 5:00 تک کھلا۔", "ur")).toEqual([expect.stringMatching(/^times /)]);
    });

    it("refuses a.m./p.m. added to a time that had none, and a time turned into 24 hours where the English gave none", () => {
      expect(lostFacts("Prayers at 1:30.", "Oraciones a la 1:30 pm.", "es")).not.toEqual([]);
      expect(lostFacts("Prayers at 1:30.", "Prières à 13 h 30.", "fr")).not.toEqual([]);
    });

    it("does not read '4H' (a name) or a price as a time", () => {
      expect(lostFacts("The 4H club meets.", "Le club 4H se réunit.", "fr")).toEqual([]);
      expect(lostFacts("Lunch is $12.50.", "Le dîner coûte 12.50 $.", "fr")).toEqual([]);
    });
  });

  describe("weekdays", () => {
    it("refuses Monday to Friday turned into Monday to Saturday, in each script's weekday names", () => {
      const english = "Open Monday to Friday.";
      const cases: [string, string, string][] = [
        ["fr", "Ouvert du lundi au vendredi.", "Ouvert du lundi au samedi."],
        ["es", "Abierto de lunes a viernes.", "Abierto de lunes a sábado."],
        ["tl", "Bukas mula Lunes hanggang Biyernes.", "Bukas mula Lunes hanggang Sabado."],
        ["sk", "Otvorené od pondelka do piatku.", "Otvorené od pondelka do soboty."],
        ["el", "Ανοιχτά Δευτέρα έως Παρασκευή.", "Ανοιχτά Δευτέρα έως Σάββατο."],
        ["zh", "周一至周五开放。", "周一至周六开放。"],
        ["hi", "सोमवार से शुक्रवार तक खुला।", "सोमवार से शनिवार तक खुला।"],
        ["pa", "ਸੋਮਵਾਰ ਤੋਂ ਸ਼ੁੱਕਰਵਾਰ ਤੱਕ ਖੁੱਲ੍ਹਾ।", "ਸੋਮਵਾਰ ਤੋਂ ਸ਼ਨੀਵਾਰ ਤੱਕ ਖੁੱਲ੍ਹਾ।"],
        ["gu", "સોમવારથી શુક્રવાર સુધી ખુલ્લું.", "સોમવારથી શનિવાર સુધી ખુલ્લું."],
        ["bn", "সোমবার থেকে শুক্রবার খোলা।", "সোমবার থেকে শনিবার খোলা।"],
        ["ta", "திங்கள் முதல் வெள்ளி வரை திறந்திருக்கும்.", "திங்கள் முதல் சனி வரை திறந்திருக்கும்."],
        ["ur", "پیر سے جمعہ تک کھلا۔", "پیر سے ہفتہ تک کھلا۔"],
        ["ps", "له دوشنبې څخه تر جمعې پورې خلاص دی.", "له دوشنبې څخه تر شنبې پورې خلاص دی."],
        ["prs", "از دوشنبه تا جمعه باز است.", "از دوشنبه تا شنبه باز است."],
      ];
      for (const [lang, right, wrong] of cases) {
        expect(lostFacts(english, wrong, lang as never), `${lang} wrong`).toEqual([expect.stringMatching(/^weekdays Monday, Friday/)]);
        expect(lostFacts(english, right, lang as never), `${lang} right`).toEqual([]);
      }
    });

    it("reads a Persian-script compound day as one day: سه شنبه is Tuesday, not a Saturday", () => {
      expect(weekdays("سه‌شنبه و پنجشنبه", "prs")).toEqual([1, 3]);
      expect(weekdays("سه شنبه", "ps")).toEqual([1]);
      expect(weekdays("جمعرات اور جمعہ", "ur")).toEqual([3, 4]);
    });

    it("refuses when it cannot tell: a day the table does not know, a word that also means 'week'", () => {
      expect(lostFacts("Open Sunday.", "Abierto el dom.", "es")).not.toEqual([]);
      expect(lostFacts("Meets every week.", "ہر ہفتہ ملاقات ہوتی ہے۔", "ur")).not.toEqual([]);
    });

    it("keeps English abbreviations case-sensitive: 'sat' in a sentence is not Saturday", () => {
      expect(weekdays("She sat down. Open Sat and Sun.")).toEqual([5, 6]);
    });
  });

  describe("contacts", () => {
    it.each([
      ["a changed phone number", URDU.replace("416-421-0792", "416-421-0793"), "phone number 416-421-0792"],
      ["a changed postal code", URDU.replace("M4H 1L1", "M4H 1L2"), "postal code M4H 1L1"],
      ["a changed email", URDU.replace("info@example.org", "info@example.com"), "email info@example.org"],
      ["a dropped web address", URDU.replace("https://example.org/help", ""), "web address https://example.org/help"],
      ["an invented email", `${URDU} help@example.org`, "email help@example.org that the English does not have"],
      ["an invented web address", `${URDU} www.example.com`, "web address www.example.com that the English does not have"],
    ])("names %s", (_, translation, lost) => {
      expect(lostFacts(ENGLISH, translation, "ur")).toContain(lost);
    });
  });

  it("refuses a bidirectional override or isolate, which can show digits in another order than stored", () => {
    expect(lostFacts(ENGLISH, URDU.replace("416-421-0792", "‮416-421-0792‬"), "ur")).toContain("a bidirectional control character that can reorder what is shown");
    expect(lostFacts(ENGLISH, URDU.replace("416-421-0792", "⁦416-421-0792⁩"), "ur")).not.toEqual([]);
  });
});
