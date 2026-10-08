// The security headers every response carries (SIT of 2026-10-08, finding F3), set by next.config.ts. Pure, so a unit test reads
// exactly what the build sends.
//
// The Content-Security-Policy allows what the app loads and nothing else:
// - scripts and styles from this origin, plus inline ones: Next.js writes its own inline scripts (the page's data and its boot), the
//   resident layout has one inline boot script, and React and Leaflet set inline styles. A nonce would make every page dynamic (the
//   map, the building, guide and numbers pages are prerendered or kept by a shared cache), so the policy relies on what it does
//   forbid instead: no script or style from another origin, no plugin, no frame, no <base>, and no form posting elsewhere.
// - images from this origin, `data:` (the authenticator's QR code is an SVG data URL; CSS masks are inline SVG), `blob:` (a map tile
//   the phone kept is drawn from a blob URL) and the map tile provider's hosts, which the map page also fetches (connect-src) to keep
//   viewed tiles. The hosts come from the same MAP_TILE_* settings the map pages are built with, so a change of provider changes both.
// - fetches to this origin only otherwise: the browser never talks to Supabase, Cohere or Twilio (the server does), and no analytics
//   script is loaded.
// - no page may be framed (frame-ancestors 'none', and X-Frame-Options DENY for older browsers).
import type { MapTileConfig } from "./mapTiles";

export interface SecurityHeader {
  key: string;
  value: string;
}

/**
 * The origins the map's tiles come from: the template's origin, once per subdomain letter when it has {s}
 * (`https://{s}.basemaps.cartocdn.com/...` with `abcd` gives a. to d.basemaps.cartocdn.com). Only https origins.
 */
export function tileOrigins(tiles: Pick<MapTileConfig, "urlTemplate" | "subdomains">): string[] {
  const letters = tiles.urlTemplate.includes("{s}") ? [...tiles.subdomains] : [""];
  const origins = new Set<string>();
  for (const letter of letters) {
    try {
      const url = new URL(tiles.urlTemplate.replaceAll("{s}", letter).replace(/\{[a-z]+\}/g, "0"));
      if (url.protocol === "https:") origins.add(url.origin);
    } catch {
      // readMapTileConfig has already refused a template that is not an https URL.
    }
  }
  return [...origins];
}

/** The Content-Security-Policy. `development` adds what `next dev` needs (eval for its fast refresh); a production build never has it. */
export function contentSecurityPolicy(options: { tileOrigins: readonly string[]; development?: boolean }): string {
  const tiles = options.tileOrigins.join(" ");
  const directives: [string, string][] = [
    ["default-src", "'self'"],
    ["script-src", `'self' 'unsafe-inline'${options.development ? " 'unsafe-eval'" : ""}`],
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", `'self' data: blob: ${tiles}`.trim()],
    ["font-src", "'self'"],
    ["connect-src", `'self' ${tiles}`.trim()],
    ["worker-src", "'self'"],
    ["manifest-src", "'self'"],
    ["media-src", "'self'"],
    ["frame-src", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  return directives.map(([name, value]) => `${name} ${value}`).join("; ");
}

/**
 * Every response's security headers. Referrer-Policy is strict-origin-when-cross-origin here; the subscription pages and API, whose
 * address holds a token, override it with no-referrer (next.config.ts lists them after this rule, and the last rule wins). The map
 * does not ask for the phone's location, so no feature is allowed beyond what the pages use (none of these).
 */
export function securityHeaders(options: { tileOrigins: readonly string[]; development?: boolean }): SecurityHeader[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
}

/** The staff surface and the API are never for a search engine (with robots.txt, src/app/robots.ts). */
export const NO_INDEX: SecurityHeader = { key: "X-Robots-Tag", value: "noindex, nofollow" };
