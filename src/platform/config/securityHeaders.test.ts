// The security headers (SIT F3): the policy allows the map tile hosts the map pages are built with and nothing else from another
// origin, forbids framing, and next.config.ts sends them on every path with the subscription pages' no-referrer winning.
import { describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "../../../next.config";
import { DEFAULT_MAP_TILES, readMapTileConfig } from "./mapTiles";
import { contentSecurityPolicy, securityHeaders, tileOrigins } from "./securityHeaders";

const directives = (policy: string) => new Map(policy.split("; ").map((d) => [d.split(" ")[0]!, d.split(" ").slice(1)]));

describe("tileOrigins", () => {
  it("lists one origin per subdomain letter of the keyless default, and the one origin of CARTO's keyed URL", () => {
    expect(tileOrigins(DEFAULT_MAP_TILES)).toEqual(["https://a.basemaps.cartocdn.com", "https://b.basemaps.cartocdn.com", "https://c.basemaps.cartocdn.com", "https://d.basemaps.cartocdn.com"]);
    const keyed = readMapTileConfig({
      MAP_TILE_URL: "https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=public-browser-key",
      MAP_TILE_ATTRIBUTION: "© OpenStreetMap contributors © CARTO",
    });
    expect(tileOrigins(keyed)).toEqual(["https://basemaps.cartocdn.com"]);
  });

  it("keeps the port of a provider that names one, and never the path or the key", () => {
    expect(tileOrigins({ urlTemplate: "https://tiles.example.org:8443/{z}/{x}/{y}.png?api_key=abc", subdomains: "" })).toEqual(["https://tiles.example.org:8443"]);
  });
});

describe("contentSecurityPolicy", () => {
  const policy = directives(contentSecurityPolicy({ tileOrigins: ["https://basemaps.cartocdn.com"] }));

  it("forbids framing, plugins, frames, <base> and forms posting elsewhere", () => {
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("frame-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.get("default-src")).toEqual(["'self'"]);
  });

  it("loads scripts, styles and fonts from this origin only, and never eval in a production build", () => {
    expect(policy.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("font-src")).toEqual(["'self'"]);
    expect(directives(contentSecurityPolicy({ tileOrigins: [], development: true })).get("script-src")).toContain("'unsafe-eval'");
  });

  it("allows the tile hosts for images and fetches (the phone keeps viewed tiles), and blob: and data: images only", () => {
    expect(policy.get("img-src")).toEqual(["'self'", "data:", "blob:", "https://basemaps.cartocdn.com"]);
    expect(policy.get("connect-src")).toEqual(["'self'", "https://basemaps.cartocdn.com"]);
    expect(directives(contentSecurityPolicy({ tileOrigins: [] })).get("connect-src")).toEqual(["'self'"]);
  });
});

describe("next.config.ts headers", () => {
  const headersFor = async (path: string) => {
    const rules = await nextConfig.headers!();
    // The rules as Next applies them (its own matcher): every rule whose source matches, in order, a later key replacing an earlier one.
    const matches = (source: string) => getPathMatch(source)(path) !== false;
    const out = new Map<string, string>();
    for (const rule of rules) if (matches(rule.source)) for (const { key, value } of rule.headers) out.set(key.toLowerCase(), value);
    return out;
  };

  it("does not advertise Next.js", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sends the security headers on resident pages, staff pages and the API", async () => {
    for (const path of ["/", "/en", "/en/map", "/staff/sign-in", "/api/search", "/serwist/sw.js"]) {
      const headers = await headersFor(path);
      expect(headers.get("content-security-policy"), path).toContain("frame-ancestors 'none'");
      expect(headers.get("x-frame-options"), path).toBe("DENY");
      expect(headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(headers.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
      expect(headers.get("permissions-policy"), path).toContain("geolocation=()");
    }
  });

  it("marks the staff surface and the API noindex, and leaves resident pages indexable", async () => {
    for (const path of ["/staff", "/staff/sign-in", "/api/search", "/api/staff/sign-in"]) expect((await headersFor(path)).get("x-robots-tag"), path).toBe("noindex, nofollow");
    for (const path of ["/", "/en", "/en/buildings/123"]) expect((await headersFor(path)).has("x-robots-tag"), path).toBe(false);
  });

  it("keeps no-referrer (and no-store) on the subscription pages and API, which carry a token", async () => {
    for (const path of ["/en/subscription/abc", "/api/subscription/abc"]) {
      const headers = await headersFor(path);
      expect(headers.get("referrer-policy"), path).toBe("no-referrer");
      expect(headers.get("cache-control"), path).toBe("no-store");
    }
  });

  it("matches the policy the module makes from the default tile settings", () => {
    expect(securityHeaders({ tileOrigins: tileOrigins(DEFAULT_MAP_TILES) })[0]!.value).toContain("https://a.basemaps.cartocdn.com");
  });
});
