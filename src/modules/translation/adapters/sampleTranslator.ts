// A fake translation model for local runs and the end-to-end tests (S04.05): `CVH_FAKE_TRANSLATOR=sample` (local development only;
// the environment check refuses it on Vercel). It answers every language with a fixed sample sentence that passes that language's
// checks, whatever it was asked to translate, so a submit can be run end to end in a browser with no Cohere key, no network and no
// cost. The text it returns is NOT a translation of the alert: it is the sample alert of the translation tests
// (domain/alertFixtures.ts) in each language. A real translation is only ever Cohere's (AD-10).
import { GOOD } from "../domain/alertFixtures";
import { TranslateError, type TranslateRequest, type Translation, type Translator } from "../application/ports";

/**
 * The sample texts: the fixture's, except Chinese, whose fixture names the street in Latin letters (a copy of the English's
 * words, which the script check ignores only when the alert says them too), so it is written here without them.
 */
const SAMPLES: Record<string, string> = { ...GOOD, zh: "电梯停止运行。请使用楼梯，如需帮助请致电中心。" };

export function sampleTranslator(): Translator {
  return {
    async translate(request: TranslateRequest): Promise<Translation> {
      if (request.signal.aborted) throw new TranslateError("aborted");
      const text = SAMPLES[request.to];
      if (text === undefined) throw new TranslateError("other");
      return { text, inputTokens: 0, outputTokens: 0 };
    },
  };
}
