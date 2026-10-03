import tokens from "../../../../design/prototype/ds/cvrh/tokens.json";
import type { LaunchLanguage } from "@/i18n/languages";
// Not "@/ui": the layout imports this file, and the index would bring the layout primitives' stylesheets with it.
import { FALLBACK_MARKER } from "@/ui/text/resident-text";

type Colour = { name: string; value: string | { light: string; dark: string } };

/** A colour token's light value (the resident app opens in the light theme). */
export function lightColour(name: string): string {
  const token = (tokens.color.tokens as Colour[]).find((entry) => entry.name === name);
  if (!token) throw new Error(`No colour token "${name}"`);
  return typeof token.value === "string" ? token.value : token.value.light;
}

/** The icons, made from the Hub's symbol (design/prototype/assets/logos/symbol.png). */
export const ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
] as const;

/**
 * The manifest of one language. One app whatever the language (`id` and `scope` are the whole site), so changing language
 * in the installed app stays in it; it opens on that language's home (the "Now" screen), in the language's direction.
 * The background is the page colour (`surface`) and the theme the header's (`surface-raised`).
 */
export function webAppManifest(language: Pick<LaunchLanguage, "code" | "bcp47" | "dir">, name: string) {
  const shown = name.replace(FALLBACK_MARKER, "");
  return {
    id: "/",
    name: shown,
    short_name: "CVH",
    lang: language.bcp47,
    dir: language.dir,
    start_url: `/${language.code}`,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: lightColour("surface"),
    theme_color: lightColour("surface-raised"),
    icons: ICONS,
  };
}
