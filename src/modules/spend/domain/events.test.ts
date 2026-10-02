import { describe, expect, it } from "vitest";
import { SpendEventError, toSpendEvent } from "./events";

const embed = { kind: "embed", purpose: "publish", model: "embed-v4.0", releaseV: 4, tokens: 1200 } as const;

describe("a spend event", () => {
  it("records the model, the tokens and the release, with one call and no price while the price is unknown", () => {
    expect(toSpendEvent(embed)).toEqual({ ...embed, calls: 1, tokensEstimated: false, ms: null, pricePerMillionTokensCad: null });
  });

  it("can say its tokens are an estimate and how long the call took", () => {
    expect(toSpendEvent({ ...embed, tokensEstimated: true, ms: 840 })).toMatchObject({ tokensEstimated: true, ms: 840 });
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

  it("names the fields that are wrong and never their values", () => {
    expect(() => toSpendEvent({ ...embed, model: "secret model name!" })).toThrow(/\(model\)/);
    expect(() => toSpendEvent({ ...embed, model: "secret model name!" })).not.toThrow(/secret/);
  });
});
