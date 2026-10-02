import {
  Noto_Naskh_Arabic,
  Noto_Sans,
  Noto_Sans_Bengali,
  Noto_Sans_Devanagari,
  Noto_Sans_Gujarati,
  Noto_Sans_Gurmukhi,
  Noto_Sans_SC,
  Noto_Sans_Tamil,
  Public_Sans,
} from "next/font/google";
import type { LaunchLanguage } from "@/i18n/languages";

// AD-16: a page loads only its own language's font. Next downloads these from Google Fonts at build time and
// serves them from the app's own origin, so there is no font CDN at runtime. Every face is declared in the
// stylesheet, but a browser fetches a font file only for text that uses it, and only the unicode-range slices
// that text needs; the stack below names the active language's face alone. Nothing is preloaded except the
// Latin face, because a preload link is added for every font a layout imports, whatever the language.
const publicSans = Public_Sans({ subsets: ["latin", "latin-ext"], display: "swap" });
const naskh = Noto_Naskh_Arabic({ subsets: ["arabic"], display: "swap", preload: false });
const gujarati = Noto_Sans_Gujarati({ subsets: ["gujarati"], display: "swap", preload: false });
const tamil = Noto_Sans_Tamil({ subsets: ["tamil"], display: "swap", preload: false });
const greek = Noto_Sans({ subsets: ["greek"], display: "swap", preload: false });
const bengali = Noto_Sans_Bengali({ subsets: ["bengali"], display: "swap", preload: false });
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], display: "swap", preload: false });
const gurmukhi = Noto_Sans_Gurmukhi({ subsets: ["gurmukhi"], display: "swap", preload: false });
const simplifiedChinese = Noto_Sans_SC({ subsets: ["latin"], display: "swap", preload: false });

const SCRIPT_FONTS: Record<LaunchLanguage["font"], string | null> = {
  latin: null,
  naskh: naskh.style.fontFamily,
  gujarati: gujarati.style.fontFamily,
  tamil: tamil.style.fontFamily,
  greek: greek.style.fontFamily,
  bengali: bengali.style.fontFamily,
  devanagari: devanagari.style.fontFamily,
  gurmukhi: gurmukhi.style.fontFamily,
  sc: simplifiedChinese.style.fontFamily,
};

/**
 * The font-family list for a language: Public Sans first, which has Latin letters only and so takes the Latin
 * text in any language (the "[EN]" fallback strings, digits, names), then the language's own script's Noto face,
 * then the design tokens' stack. It is the value of --font-script on <html>.
 */
export function fontStack(font: LaunchLanguage["font"]): string {
  const script = SCRIPT_FONTS[font];
  return [publicSans.style.fontFamily, script, "var(--type-family-sans)"].filter(Boolean).join(", ");
}
