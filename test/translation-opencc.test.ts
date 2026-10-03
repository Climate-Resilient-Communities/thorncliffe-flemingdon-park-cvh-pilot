// zh-Hant of an alert, converted by the real OpenCC (S04.02, AD-10): the same library, version and configuration the catalogue and the
// guides use (directory's `openccZhHant`, which scripts/opencc_convert.mjs mirrors). The translation module may not import directory, so
// the composition root gives it the converter; this test plays that root, with a fake model and an in-memory cache.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openccZhHant } from "@/modules/directory";
import { createAlertTranslator, type CachedTranslation, type TranslationCache, type TranslationCacheKey } from "@/modules/translation";
import { sha256Hex } from "@/platform/hash";
import { ENGLISH_ALERT, GOOD, SEEDED_ROUTES } from "../src/modules/translation/domain/alertFixtures";
import { fakeTranslator } from "../src/modules/translation/adapters/fakeTranslator";

function memoryCache() {
  const rows = new Map<string, CachedTranslation>();
  const puts: TranslationCacheKey[] = [];
  const cache: TranslationCache = {
    async get(key) {
      return rows.get(JSON.stringify(key)) ?? null;
    },
    async put(key, value) {
      puts.push(key);
      rows.set(JSON.stringify(key), value);
    },
  };
  return { cache, puts };
}

function alerts(zhHant: Parameters<typeof createAlertTranslator>[0]["zhHant"], cache: TranslationCache, fake = fakeTranslator((call) => ({ text: GOOD[call.lang]! }))) {
  return { fake, translator: createAlertTranslator({ translator: fake.translator, routes: async () => SEEDED_ROUTES, cache, recordSpend: async () => {}, zhHant, promptVersion: "p1" }) };
}

describe("zh-Hant of an alert with the real OpenCC", () => {
  it("is the passing zh text converted as the catalogue's scripts convert it, marked script_converted, with OpenCC's version and configuration recorded", async () => {
    const converter = await openccZhHant();
    const { translator } = alerts(openccZhHant, memoryCache().cache);

    const { translations } = await translator.translate({ english: ENGLISH_ALERT });

    const zh = translations.find((text) => text.lang === "zh")!;
    const hant = translations.find((text) => text.lang === "zh-Hant")!;
    expect(hant.body).toBe("85 Thorncliffe Park Dr 的電梯停止執行。請使用樓梯，如需幫助請致電 Hub。");
    expect(hant).toMatchObject({
      status: "script_converted",
      machine: true,
      model: `opencc-js ${converter.openccVersion}`,
      source_hash: sha256Hex(ENGLISH_ALERT),
      conversion: { from: "zh", from_text_hash: sha256Hex(zh.body), opencc_version: converter.openccVersion, config: converter.config },
    });
    expect(converter.config).toContain("OpenCC s2twp");

    const script = path.join(__dirname, "..", "scripts", "opencc_convert.mjs");
    const offline = JSON.parse(execFileSync("node", [script], { input: JSON.stringify({ texts: { a: zh.body } }) }).toString());
    expect(hant.body).toBe(offline.texts.a);
    expect(hant.conversion).toMatchObject({ opencc_version: offline.openccVersion, config: offline.config });
  });

  it("converts again, without asking a model again, when OpenCC's version or configuration changes, and reuses the conversion otherwise", async () => {
    const real = await openccZhHant();
    const store = memoryCache();
    const first = alerts(async () => real, store.cache);
    await first.translator.translate({ english: ENGLISH_ALERT });
    const asked = first.fake.calls.length;
    let conversions = 0;
    const counting = (change: { openccVersion?: string; config?: string }) => async () => ({
      ...real,
      ...change,
      convert: (text: string) => {
        conversions += 1;
        return real.convert(text);
      },
    });

    const same = alerts(counting({}), store.cache, first.fake);
    await same.translator.translate({ english: ENGLISH_ALERT });
    expect(conversions).toBe(0);

    await alerts(counting({ openccVersion: "9.9.9" }), store.cache, first.fake).translator.translate({ english: ENGLISH_ALERT });
    expect(conversions).toBe(1);

    await alerts(counting({ config: "opencc-js Converter({ from: \"cn\", to: \"tw\" }) (OpenCC s2tw)" }), store.cache, first.fake).translator.translate({ english: ENGLISH_ALERT });
    expect(conversions).toBe(2);

    expect(first.fake.calls).toHaveLength(asked);
    expect(store.puts.filter((key) => key.lang === "zh-Hant").map((key) => key.openccVersion)).toEqual([real.openccVersion, "9.9.9", real.openccVersion]);
  });
});
