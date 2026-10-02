import publicSansLatin from "@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2";
import type { LaunchLanguage } from "@/i18n/languages";

/** The URL of the Latin slice of Public Sans, which the stylesheet declares from the same file. */
export const PUBLIC_SANS_LATIN: string = typeof publicSansLatin === "string" ? publicSansLatin : publicSansLatin.src;

// AD-16: a page loads only its own language's font, and every font is self-hosted: fonts.generated.css (made by
// scripts/gen-fonts.mjs from the version-pinned @fontsource-variable packages) declares each face with its
// unicode-range slices, and Next serves the files from the app's own origin, so no font CDN is contacted at build
// or run time. A browser fetches a font file only for text that uses it, and only the slices that text needs;
// the stack below names the active language's face alone. This file and the stylesheet are imported by the
// [lang] layout only; the staff layout has its own file and stylesheet (Public Sans alone), and the site pages declare
// no font at all.
const PUBLIC_SANS = "'Public Sans'";

const SCRIPT_FONTS: Record<LaunchLanguage["font"], string | null> = {
  latin: null,
  naskh: "'Noto Naskh Arabic'",
  gujarati: "'Noto Sans Gujarati'",
  tamil: "'Noto Sans Tamil'",
  greek: "'Noto Sans'",
  bengali: "'Noto Sans Bengali'",
  devanagari: "'Noto Sans Devanagari'",
  gurmukhi: "'Noto Sans Gurmukhi'",
  sc: "'Noto Sans SC'",
};

/**
 * The font-family list for a language: Public Sans first, which has Latin letters only and so takes the Latin
 * text in any language (the "[EN]" fallback strings, digits, names), then the language's own script's Noto face,
 * then the design tokens' stack. It is the value of --font-script on <html>.
 */
export function fontStack(font: LaunchLanguage["font"]): string {
  const script = SCRIPT_FONTS[font];
  return [PUBLIC_SANS, script, "var(--type-family-sans)"].filter(Boolean).join(", ");
}
