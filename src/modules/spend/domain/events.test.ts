import { describe, expect, it } from "vitest";
import { SpendEventError, toSpendEvent } from "./events";

const embed = { kind: "embed", purpose: "publish", model: "embed-v4.0", releaseV: 4, tokens: 1200 } as const;

describe("a spend event", () => {
  it("records the model, the tokens and the release, with one call and no price while the price is unknown", () => {
    expect(toSpendEvent(embed)).toEqual({ ...embed, calls: 1, tokensEstimated: false, ms: null, pricePerMillionTokensCad: null, entryId: null, isDrill: null });
  });

  it("can say its tokens are an estimate and how long the call took", () => {
    expect(toSpendEvent({ ...embed, tokensEstimated: true, ms: 840 })).toMatchObject({ tokensEstimated: true, ms: 840 });
  });

  it("knows the purposes of the calls the app makes, among them the translation of an alert (S04.02)", () => {
    for (const purpose of ["publish", "search", "test_set", "alert"] as const) expect(toSpendEvent({ ...embed, purpose }).purpose).toBe(purpose);
    expect(toSpendEvent({ kind: "translate", purpose: "alert", model: "north-small-translate-09-2026", tokens: 640, ms: 3100 })).toMatchObject({
      kind: "translate",
      purpose: "alert",
      releaseV: null,
      calls: 1,
    });
  });

  it("is refused with a field it does not know, so no question or text can be stored", () => {
    expect(() => toSpendEvent({ ...embed, q: "where is the food bank" } as never)).toThrow(SpendEventError);
    expect(() => toSpendEvent({ ...embed, text: "Free legal help" } as never)).toThrow(SpendEventError);
  });

  it.each([
    ["a kind that is not a code", { kind: "Embed Call" }],
    ["a purpose it does not know", { purpose: "marketing" }],
    ["a model with spaces", { model: "embed v4" }],
    ["a release number of zero", { releaseV: 0 }],
    ["no calls", { calls: 0 }],
    ["negative tokens", { tokens: -1 }],
    ["a fractional token count", { tokens: 1.5 }],
    ["a negative price", { pricePerMillionTokensCad: -1 }],
  ])("is refused with %s", (_name, change) => {
    expect(() => toSpendEvent({ ...embed, ...change } as never)).toThrow(SpendEventError);
  });

  it("can say which alert entry a call was made for and whether it is a drill's, both together and for the alert purpose only (S07.10)", () => {
    const alert = { kind: "translate", purpose: "alert", model: "north-small-translate-09-2026", tokens: 640 } as const;
    const entryId = "01900000-0000-7000-8000-0000000000e1";
    expect(toSpendEvent({ ...alert, entryId, isDrill: true })).toMatchObject({ entryId, isDrill: true });
    expect(() => toSpendEvent({ ...alert, entryId })).toThrow(SpendEventError);
    expect(() => toSpendEvent({ ...alert, isDrill: false })).toThrow(SpendEventError);
    expect(() => toSpendEvent({ ...embed, entryId, isDrill: false })).toThrow(SpendEventError);
    expect(() => toSpendEvent({ ...alert, entryId: "not an id", isDrill: false })).toThrow(SpendEventError);
  });

  it("names the fields that are wrong and never their values", () => {
    expect(() => toSpendEvent({ ...embed, model: "secret model name!" })).toThrow(/\(model\)/);
    expect(() => toSpendEvent({ ...embed, model: "secret model name!" })).not.toThrow(/secret/);
  });
});
