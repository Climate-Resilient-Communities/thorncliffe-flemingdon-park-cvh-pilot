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

  it("returns the same result for the same input (pure), however calls are interleaved", () => {
    const inputs: [string, LangCode][] = [
      ["Potrebujem jedlo pre deti", "en"], ["food bank", "es"], ["mujhe khana chahiye", "ur"],
      ["زه د ماشومانو لپاره خواړه غواړم", "en"], ["医生", "fr"], ["doctor kithe milega", "pa"], ["😀", "en"],
    ];
    const first = inputs.map(([q, p]) => detect(q, p));
    for (let round = 0; round < 3; round++) {
      for (const i of [...inputs.keys()].reverse()) {
        detect(inputs[(i + 3) % inputs.length][0], "tl"); // unrelated call in between
        expect(detect(inputs[i][0], inputs[i][1])).toEqual(first[i]);
      }
    }
    expect(inputs.map(([q, p]) => detect(q, p))).toEqual(first);
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
    for (const q of ["زه د ماشومانو لپاره خواړه غواړم", "کودکان غذا کمک میخواهم ښار"]) {
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

  it("treats Pashto letters together with Urdu letters as ambiguous_arabic", () => {
    expect(detect("ماشومان ټول ے مجھے", "ur")).toEqual({ lang: null, confidence: "ambiguous_arabic", query_lang: "ur" });
    expect(detect("زه ټ ٹ", "en")).toMatchObject({ confidence: "ambiguous_arabic" });
  });

  it("keeps Pashto-letters-only text as ps, never ur or prs", () => {
    expect(detect("زه د ماشومانو لپاره خواړه غواړم", "ur").lang).toBe("ps");
  });

  describe("scripts that map to one launch language", () => {
    it.each(["医生", "醫生", "租金", "帮助", "食物"])("is confident in zh from Han script alone: %s", (q) => {
      expect(detect(q, "en")).toEqual({ lang: "zh", confidence: "confident", query_lang: "zh" });
    });
    it("does not call Han with kana confident zh", () => {
      expect(detect("医生です", "en").confidence).not.toBe("confident");
    });
  });

  describe("zh-Hant page", () => {
    it.each(["我需要幫助", "食物銀行在哪裡"])("answers in zh-Hant: %s", (q) => {
      expect(detect(q, "zh-Hant")).toEqual({ lang: "zh", confidence: "confident", query_lang: "zh-Hant" });
    });
    it("answers in zh on other pages", () => {
      expect(detect("我需要幫助", "en").query_lang).toBe("zh");
    });
  });

  describe("short Latin questions", () => {
    const en = ["food bank", "food", "doctor", "clinic", "dentist", "rent help", "free wifi", "OHIP card", "seniors programs"];
    it.each(en)("is confident en: %s", (q) => {
      expect(detect(q, "en")).toEqual({ lang: "en", confidence: "confident", query_lang: "en" });
    });
    it.each([["comida", "es"], ["médico", "es"], ["j'ai faim", "fr"], ["pagkain", "tl"], ["tulong", "tl"], ["lekár", "sk"], ["pomoc", "sk"]] as [string, LangCode][])(
      "is confident in the language of %s on an en page", (q, lang) => {
        expect(detect(q, "en")).toEqual({ lang, confidence: "confident", query_lang: lang });
      });
    // Known limitation: eld scores "abogado" es 0.805 vs tl 0.781, a gap no sound margin trusts; it falls back to the page language.
    it("falls back to the page language for abogado (known limitation)", () => {
      expect(detect("abogado", "en")).toEqual({ lang: null, confidence: "romanized_or_mixed", query_lang: "en" });
      expect(detect("abogado", "es")).toEqual({ lang: "es", confidence: "confident", query_lang: "es" });
    });
    it("is confident es for comida on an es page", () => {
      expect(detect("comida", "es")).toEqual({ lang: "es", confidence: "confident", query_lang: "es" });
    });
  });

  describe("romanized South Asian text", () => {
    const romanized: [string, LangCode][] = [
      ["doctor kithe milega", "en"], ["doctor kithe milega", "ur"], ["doctor kithe milega", "pa"],
      ["mainu doctor chahida", "en"], ["free food kithe milda", "en"], ["ami help chai", "en"],
      ["need doctor urgent please bhai", "en"], ["need help with rent yaar", "en"], ["food chahiye", "en"],
    ];
    it.each(romanized)("is romanized_or_mixed: %s (page %s)", (q, page) => {
      expect(detect(q, page)).toEqual({ lang: null, confidence: "romanized_or_mixed", query_lang: page });
    });
  });

  describe("marker-word false positives", () => {
    it("keeps ordinary English with one marker-like word as en", () => {
      expect(detect("where can I buy chow mein", "fr")).toEqual({ lang: "en", confidence: "confident", query_lang: "en" });
    });
    it("keeps Tagalog with one marker-like word as tl", () => {
      expect(detect("Hai, kailangan ko ng tulong", "en")).toEqual({ lang: "tl", confidence: "confident", query_lang: "tl" });
    });
  });
});
