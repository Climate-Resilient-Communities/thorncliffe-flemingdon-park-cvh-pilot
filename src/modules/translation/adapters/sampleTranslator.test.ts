import { describe, expect, it } from "vitest";
import { checkAlertTranslation } from "../domain/alertChecks";
import { SEEDED_ROUTES } from "../domain/alertFixtures";
import { sampleTranslator } from "./sampleTranslator";
import { TranslateError } from "../application/ports";

describe("the sample translator (CVH_FAKE_TRANSLATOR=sample)", () => {
  it("answers every language a model translates into with a text that passes that language's checks, for any English", async () => {
    const translator = sampleTranslator();
    for (const route of SEEDED_ROUTES) {
      const answer = await translator.translate({ text: "Power is out in the building.", from: "en", to: route.lang, model: "m", signal: new AbortController().signal });
      expect(checkAlertTranslation(route.check, "Power is out in the building.", answer.text), route.lang).toBeNull();
    }
  });

  it("fails for a language it has no sample for, and ends at once when cancelled", async () => {
    const translator = sampleTranslator();
    await expect(translator.translate({ text: "x", from: "en", to: "zh-Hant", model: "m", signal: new AbortController().signal })).rejects.toBeInstanceOf(TranslateError);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(translator.translate({ text: "x", from: "en", to: "ur", model: "m", signal: cancelled.signal })).rejects.toMatchObject({ code: "aborted" });
  });
});
