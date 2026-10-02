import { describe, expect, it } from "vitest";
import { detect } from "@/modules/directory/domain/questionLanguage";
import type { LangCode } from "@/contracts/lang";

const confident: [LangCode, string][] = [
  ["en", "What food help is there for children"],
  ["es", "Ayuda con comida para niños"],
  ["fr", "Je cherche de l'aide alimentaire pour mes enfants"],
  ["tl", "Kailangan ko ng pagkain para sa mga bata"],
  ["sk", "Potrebujem jedlo pre deti"],
  ["bn", "মাকে খাবার দরকার"],
  ["hi", "मुझे बच्चों के लिए खाना चाहिए"],
  ["pa", "ਮੈਨੂੰ ਖਾਣਾ ਚਾਹੀਦਾ ਹੈ"],
  ["zh", "我需要食物給孩子"],
  ["el", "χρειάζομαι φαγητό"],
  ["ta", "எனக்கு உணவு வேண்டும்"],
  ["gu", "મને ખોરાક જોઈએ છે"],
  ["ur", "مجھے بچوں کے لیے کھانا چاہیے"],
  ["prs", "کودکان غذا کمک میخواهم"],
  ["ps", "زه د ماشومانو لپاره خواړه غواړم"],
];

describe("directory/domain/questionLanguage#detect", () => {
  it.each(confident)("is confident in %s and shows results in it", (lang, q) => {
    // Page language differs from the question language on purpose.
    const pageLang: LangCode = lang === "en" ? "fr" : "en";
    expect(detect(q, pageLang)).toEqual({ lang, confidence: "confident", query_lang: lang });
  });

  it("returns the same result for the same input (pure)", () => {
    expect(detect("Potrebujem jedlo pre deti", "en")).toEqual(detect("Potrebujem jedlo pre deti", "en"));
  });

  it("treats romanized Urdu as romanized_or_mixed", () => {
    expect(detect("mujhe bachon ke liye khana chahiye", "ur")).toEqual({
      lang: null, confidence: "romanized_or_mixed", query_lang: "ur",
    });
  });

  it("treats Hinglish that eld reads as English as romanized_or_mixed", () => {
    expect(detect("mujhe food chahiye for my kids", "hi")).toEqual({
      lang: null, confidence: "romanized_or_mixed", query_lang: "hi",
    });
  });

  it("treats mixed English and Urdu script as romanized_or_mixed", () => {
    expect(detect("I need food for بچوں", "en")).toEqual({
      lang: null, confidence: "romanized_or_mixed", query_lang: "en",
    });
  });

  it("treats Arabic script without marker letters as ambiguous_arabic", () => {
    expect(detect("مجھ کو کھانا درکار", "en")).toEqual({
      lang: null, confidence: "ambiguous_arabic", query_lang: "en",
    });
    expect(detect("أحتاج إلى طعام لأطفالي", "fr")).toEqual({
      lang: null, confidence: "ambiguous_arabic", query_lang: "fr",
    });
  });

  it("returns a Dari question that eld reports as fa as prs", () => {
    expect(detect("کودکان غذا کمک میخواهم", "en").lang).toBe("prs");
  });

  it("never returns Pashto as Urdu or Dari when Pashto marker letters are present", () => {
    // Pashto letters together with Urdu-only and Dari-looking text.
    for (const q of ["زه د ماشومانو لپاره خواړه غواړم", "ماشومان ټول ے مجھے", "کودکان غذا کمک میخواهم ښار"]) {
      expect(detect(q, "ur")).toMatchObject({ lang: "ps", confidence: "confident", query_lang: "ps" });
    }
  });

  it.each(["😀😀", "12345", "", "   "])("returns unknown for %j", (q) => {
    expect(detect(q, "es")).toEqual({ lang: null, confidence: "unknown", query_lang: "es" });
  });

  it("uses the page language for query_lang whenever the question is not confident", () => {
    for (const q of ["mujhe khana chahiye", "مجھ کو کھانا درکار", "😀", "I need خوراک"]) {
      const r = detect(q, "tl");
      expect(r.confidence).not.toBe("confident");
      expect(r.query_lang).toBe("tl");
    }
  });
});
