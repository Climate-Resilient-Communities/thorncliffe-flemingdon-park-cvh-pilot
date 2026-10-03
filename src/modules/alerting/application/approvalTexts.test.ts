import { describe, expect, it, vi } from "vitest";
import type { AlertRecipient, RecipientSmsBody } from "../../subscriptions";
import { alertTextsOf, countsOfTexts } from "./approvalTexts";

const A = "01900000-0000-7000-8000-00000000000a";
const B = "01900000-0000-7000-8000-00000000000b";
const C = "01900000-0000-7000-8000-00000000000c";

const bodies: Record<string, RecipientSmsBody> = {
  en: { body: "Hub: Power is out. Reply STOP", encoding: "gsm7", segments: 1 },
  ur: { body: "حب: بجلی بند ہے", encoding: "ucs2", segments: 3 },
};
const subscriber = (id: string, lang: AlertRecipient["lang"]): AlertRecipient => ({ kind: "subscriber", id, lang });
const price = () => 1.5;

describe("the texts of an approval (S04.07 with S06.01)", () => {
  it("gives each person the entry's frozen text message for their language, byte for byte, with its segments", () => {
    const texts = alertTextsOf({ recipients: [subscriber(A, "en"), subscriber(B, "ur")], smsBodies: bodies, pricePerSegmentCents: price });
    expect(texts).toEqual([
      { recipient: { kind: "subscriber", id: A }, lang: "en", body: bodies.en.body, segments: 1, costEstimateCents: 2 },
      { recipient: { kind: "subscriber", id: B }, lang: "ur", body: bodies.ur.body, segments: 3, costEstimateCents: 5 },
    ]);
  });

  it("gives a person whose language has no text message the English one, in a row of its own language: English", () => {
    const texts = alertTextsOf({ recipients: [subscriber(A, "ps"), subscriber(B, "zh-Hant")], smsBodies: bodies, pricePerSegmentCents: price });
    expect(texts.map(({ lang, body, segments }) => ({ lang, body, segments }))).toEqual([
      { lang: "en", body: bodies.en.body, segments: 1 },
      { lang: "en", body: bodies.en.body, segments: 1 },
    ]);
  });

  it("estimates each text as its segments times the price, rounded up to the cent", () => {
    const texts = alertTextsOf({ recipients: [subscriber(A, "en"), subscriber(B, "ur")], smsBodies: bodies, pricePerSegmentCents: () => 1.25 });
    expect(texts.map((text) => text.costEstimateCents)).toEqual([2, 4]);
  });

  it("keeps drill roster members as roster, in the order given", () => {
    const texts = alertTextsOf({ recipients: [{ kind: "roster", id: B, lang: "en" }, subscriber(A, "en")], smsBodies: bodies, pricePerSegmentCents: price });
    expect(texts.map((text) => [text.recipient.kind, text.recipient.id])).toEqual([["roster", B], ["subscriber", A]]);
  });

  it("writes one text per person: a person named twice, in any case, counts once, under the lowercase id the database gives", () => {
    const texts = alertTextsOf({ recipients: [subscriber(A.toUpperCase(), "en"), subscriber(A, "ur"), subscriber(B, "ur")], smsBodies: bodies, pricePerSegmentCents: price });
    expect(texts.map((text) => [text.recipient.id, text.lang])).toEqual([[A, "en"], [B, "ur"]]);
  });

  it("writes nothing and asks for no price when nobody is captured (all of E04 to E06: texting is not open)", () => {
    const asked = vi.fn(() => 1.5);
    expect(alertTextsOf({ recipients: [], smsBodies: {}, pricePerSegmentCents: asked })).toEqual([]);
    expect(alertTextsOf({ recipients: [], smsBodies: bodies, pricePerSegmentCents: undefined })).toEqual([]);
    expect(asked).not.toHaveBeenCalled();
  });

  it("fails for what a correct port never gives: a language that is not one, no English text message, no price, a price that is not one", () => {
    expect(() => alertTextsOf({ recipients: [subscriber(A, "xx" as AlertRecipient["lang"])], smsBodies: bodies, pricePerSegmentCents: price })).toThrow(/language that is not one/);
    expect(() => alertTextsOf({ recipients: [subscriber(A, "ur")], smsBodies: { ur: bodies.ur }, pricePerSegmentCents: price })).toThrow(/no frozen English text message/);
    expect(() => alertTextsOf({ recipients: [subscriber(A, "en")], smsBodies: bodies, pricePerSegmentCents: undefined })).toThrow(/no price per segment/);
    expect(() => alertTextsOf({ recipients: [subscriber(A, "en")], smsBodies: bodies, pricePerSegmentCents: () => 0 })).toThrow(RangeError);
  });

  it("asks for the price once per approval, not once per person", () => {
    const asked = vi.fn(() => 1.5);
    alertTextsOf({ recipients: [subscriber(A, "en"), subscriber(B, "en"), subscriber(C, "ur")], smsBodies: bodies, pricePerSegmentCents: asked });
    expect(asked).toHaveBeenCalledTimes(1);
  });
});

describe("the count an approval audits and compares (S04.07 with S06.01)", () => {
  it("is the number of texts the outbox returned, in all and by the language of the body", () => {
    expect(countsOfTexts([{ lang: "en" }, { lang: "ur" }, { lang: "en" }])).toEqual({ total: 3, byLanguage: { en: 2, ur: 1 } });
    expect(countsOfTexts([])).toEqual({ total: 0, byLanguage: {} });
  });

  it("refuses a text in a language that is not one, so the parts always add up to the total", () => {
    expect(() => countsOfTexts([{ lang: "en" }, { lang: "xx" }])).toThrow(/language that is not one/);
  });
});
