// The translated-question leg's checks (S03.05): the translation must be English and a translation, not an answer.
import { describe, expect, it } from "vitest";
import { checkTranslation, isEnglish, maxTranslationLength, normaliseTranslation, sourceLanguage } from "./questionTranslation";

describe("isEnglish", () => {
  it.each(["I need a lawyer", "Where can I get free food for my children?", "food bank", "doctor", "dentist", "free wifi", "tax help", "Where is a free dental clinic nearby?"])(
    "accepts %j, including one- and two-word translations eld cannot tell apart from other languages",
    (text) => {
      expect(isEnglish(text)).toBe(true);
    },
  );

  it.each([
    ["Spanish", "Necesito un abogado"],
    ["French", "Je cherche un médecin pour mon fils"],
    ["romanized Urdu handed back", "mujhe bachon ke liye khana chahiye"],
    ["Pashto handed back", "زه وړیا حقوقي مشوره غواړم"],
    ["Dari handed back", "کلینیک صحی رایگان بدون کارت صحی کجا است؟"],
    ["English with Arabic-script words left in", "I need مشوره for free"],
    ["no letters", "?? 123"],
  ])("refuses %s", (_, text) => {
    expect(isEnglish(text)).toBe(false);
  });
});

describe("checkTranslation", () => {
  it("passes an English translation of the question", () => {
    expect(checkTranslation("زه وړیا حقوقي مشوره غواړم", "I want free legal advice")).toBeNull();
  });

  it("refuses an empty answer", () => {
    expect(checkTranslation("مرسته", "")).toBe("empty");
  });

  it("refuses an answer far longer than the question: the model answered it instead of translating it", () => {
    const question = "مرسته";
    const answer = "Here are some places where you can find help in Toronto: the Thorncliffe Neighbourhood Office, 211 Ontario, and the Flemingdon Health Centre.";
    expect(answer.length).toBeGreaterThan(maxTranslationLength(question.length));
    expect(checkTranslation(question, answer)).toBe("too_long");
  });

  it("refuses a romanized question handed back unchanged, even one that looks English", () => {
    expect(checkTranslation("Mujhe nearby free dental clinic batao", "mujhe nearby free dental clinic batao.")).toBe("not_english");
  });

  it("refuses a translation that is not English", () => {
    expect(checkTranslation("زه وړیا حقوقي مشوره غواړم", "Necesito asesoría legal gratuita")).toBe("not_english");
  });
});

describe("normaliseTranslation", () => {
  it("drops the space and the quotation marks a model sometimes wraps its answer in", () => {
    expect(normaliseTranslation('  "I need a lawyer"\n')).toBe("I need a lawyer");
    expect(normaliseTranslation("“free food”")).toBe("free food");
    expect(normaliseTranslation("it's free")).toBe("it's free");
  });
});

describe("sourceLanguage", () => {
  it("names Pashto and Dari, and leaves romanized, mixed and ambiguous text for the model to tell", () => {
    expect(sourceLanguage("ps")).toBe("ps");
    expect(sourceLanguage("prs")).toBe("prs");
    expect(sourceLanguage("romanized_or_mixed")).toBeNull();
    expect(sourceLanguage("ambiguous_arabic")).toBeNull();
  });
});
