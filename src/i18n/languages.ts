// The 15 launch languages in the order of design/prototype/cvh/data.js (AD-16): code, BCP-47 tag for the
// lang attribute, direction, the language's own name and the Noto subset it needs. A test compares this
// table with data.js, so a direction or tag cannot drift from the prototype.
export const LAUNCH_LANGUAGES = [
  { code: "ur", bcp47: "ur", dir: "rtl", native: "اردو", font: "naskh" },
  { code: "ps", bcp47: "ps", dir: "rtl", native: "پښتو", font: "naskh" },
  { code: "tl", bcp47: "tl", dir: "ltr", native: "Tagalog", font: "latin" },
  { code: "prs", bcp47: "fa-AF", dir: "rtl", native: "دری", font: "naskh" },
  { code: "gu", bcp47: "gu", dir: "ltr", native: "ગુજરાતી", font: "gujarati" },
  { code: "ta", bcp47: "ta", dir: "ltr", native: "தமிழ்", font: "tamil" },
  { code: "el", bcp47: "el", dir: "ltr", native: "Ελληνικά", font: "greek" },
  { code: "sk", bcp47: "sk", dir: "ltr", native: "Slovenčina", font: "latin" },
  { code: "bn", bcp47: "bn", dir: "ltr", native: "বাংলা", font: "bengali" },
  { code: "hi", bcp47: "hi", dir: "ltr", native: "हिन्दी", font: "devanagari" },
  { code: "pa", bcp47: "pa-Guru", dir: "ltr", native: "ਪੰਜਾਬੀ", font: "gurmukhi" },
  { code: "zh", bcp47: "zh-Hans", dir: "ltr", native: "中文（普通话）", font: "sc" },
  { code: "es", bcp47: "es", dir: "ltr", native: "Español", font: "latin" },
  { code: "fr", bcp47: "fr", dir: "ltr", native: "Français", font: "latin" },
  { code: "en", bcp47: "en", dir: "ltr", native: "English", font: "latin" },
] as const;

export type LaunchLanguage = (typeof LAUNCH_LANGUAGES)[number];

/** A launch language code: the only values `[lang]` may take in a resident URL. */
export type LaunchCode = LaunchLanguage["code"];

export const LAUNCH_CODES = LAUNCH_LANGUAGES.map(({ code }) => code) as readonly LaunchCode[];

export const DEFAULT_LANGUAGE: LaunchCode = "en";

export function isLaunchCode(value: unknown): value is LaunchCode {
  return typeof value === "string" && (LAUNCH_CODES as readonly string[]).includes(value);
}

export function languageOf(code: LaunchCode): LaunchLanguage {
  return LAUNCH_LANGUAGES.find((language) => language.code === code)!;
}
