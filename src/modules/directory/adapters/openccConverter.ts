// OpenCC for zh-Hant (S02.05, AD-10): the same conversion the offline content scripts use (scripts/opencc_convert.mjs),
// Simplified (Mainland) to Traditional (Taiwan standard, with Taiwan phrases): OpenCC's s2twp, matching the BCP-47
// tag zh-Hant-TW the app uses for zh-Hant. The version and the configuration are recorded beside each converted text.
import type { ZhHantConverter } from "../domain/directoryRelease";

/** The installed opencc-js version; src/modules/directory/adapters/openccConverter.test.ts keeps it equal to node_modules/opencc-js/package.json. */
export const OPENCC_VERSION = "1.4.2";
const FROM = "cn";
const TO = "twp";

let converter: Promise<ZhHantConverter> | undefined;

/** OpenCC's dictionaries are large, so they load on the first conversion, not when the module is imported. */
export function openccZhHant(): Promise<ZhHantConverter> {
  converter ??= import("opencc-js/cn2t").then(({ Converter }) => {
    const convert = Converter({ from: FROM, to: TO });
    return {
      convert: (text: string) => convert(text),
      openccVersion: OPENCC_VERSION,
      config: `opencc-js Converter({ from: "${FROM}", to: "${TO}" }) (OpenCC s2twp)`,
    };
  });
  return converter;
}
