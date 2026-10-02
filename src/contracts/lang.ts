// The 15 launch languages plus zh-Hant (AD-20). The only language codes in payloads.
export const LANG_CODES = [
  "en", "ur", "ps", "tl", "prs", "gu", "ta", "el", "sk", "bn", "hi", "pa", "zh", "es", "fr", "zh-Hant",
] as const;

export type LangCode = (typeof LANG_CODES)[number];
