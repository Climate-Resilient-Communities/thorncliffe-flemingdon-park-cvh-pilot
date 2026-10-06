import { describe, expect, it } from "vitest";
import { LAUNCH_CODES } from "@/i18n/languages";
import { TILE_CACHE_NAME } from "@/ui/map/tile-cache";
import { DATA_CACHE } from "@/ui/offline/protocol";
import { isSubscriptionPath } from "@/contracts/subscriptionEdit";
import { buildIdOf, cachesToDelete, classify, directoryFilesToDelete, isRoundPath, mayStore, pagesCache, releaseOf, shouldKeepFeed, staticCache, titleOf, type RequestFacts } from "./rules";

const ORIGIN = "https://cvh.example";

function req(path: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}): RequestFacts {
  const url = path.startsWith("http") ? path : `${ORIGIN}${path}`;
  return { method: init.method ?? "GET", url, mode: init.mode, headers: new Headers(init.headers ?? {}) };
}
const page = (path: string) => req(path, { mode: "navigate", headers: { accept: "text/html" } });
const kind = (facts: RequestFacts) => classify(facts, ORIGIN).kind;

describe("which requests the service worker answers (S02.12, AD-1)", () => {
  it("answers every resident page as a page, in every launch language", () => {
    for (const lang of LAUNCH_CODES) {
      expect(classify(page(`/${lang}`), ORIGIN)).toEqual({ kind: "page", lang });
      expect(classify(page(`/${lang}/ready/numbers`), ORIGIN)).toEqual({ kind: "page", lang });
      expect(classify(page(`/${lang}/ready/heat?x=1`), ORIGIN)).toEqual({ kind: "page", lang });
    }
    // A fetch that asks for HTML without being a navigation (the worker's own refresh) is a page too.
    expect(kind(req("/en/directory", { headers: { accept: "text/html" } }))).toBe("page");
  });

  it("leaves the archive's pages (/api/feed/archive, S05.07) to the network and never stores them: the archive screen is a kept page, its older pages are asked for with signal", () => {
    const archive = req("/api/feed/archive?lang=en&page=2");

    expect(classify(archive, ORIGIN)).toEqual({ kind: "pass", reason: "not-listed" });
    expect(mayStore(`${ORIGIN}/api/feed/archive?lang=en&page=2`, ORIGIN)).toBe(false);
    // The archive screen is a page of the language like any other.
    expect(classify(page("/en/archive"), ORIGIN)).toEqual({ kind: "page", lang: "en" });
    expect(mayStore(`${ORIGIN}/en/archive`, ORIGIN)).toBe(true);
  });

  it("answers the feed, the manifest, release files and static files with their own rules", () => {
    expect(kind(req("/api/feed?lang=ur"))).toBe("feed");
    expect(kind(req("/api/directory/manifest"))).toBe("manifest");
    expect(classify(req("/api/directory/12/ur.json"), ORIGIN)).toEqual({ kind: "directory", release: 12 });
    expect(classify(req("/api/directory/12/zh-Hant.json"), ORIGIN)).toEqual({ kind: "directory", release: 12 });
    expect(kind(req("/_next/static/chunks/abc.js"))).toBe("static");
    expect(kind(req("/_next/static/media/font.woff2"))).toBe("static");
    expect(kind(req("/brand/hub-logo.png"))).toBe("static");
    expect(kind(req("/icons/icon-192.png"))).toBe("static");
  });

  it("never answers the staff surface or its API, whatever the request looks like", () => {
    for (const path of ["/staff", "/staff/", "/staff/sign-in", "/staff/buildings?x=1", "/api/staff/me", "/api/staff/sign-in"]) {
      expect(classify(page(path), ORIGIN)).toEqual({ kind: "pass", reason: "staff" });
      expect(classify(req(path), ORIGIN)).toEqual({ kind: "pass", reason: "staff" });
    }
    // A name that only starts like it is not the staff surface.
    expect(kind(page("/staffroom"))).toBe("pass");
  });

  it("S08.07: never answers the check-in round page, its read or a mark, whatever the request looks like, and they may never be stored", () => {
    for (const path of ["/staff/ambassador/round", "/staff/ambassador/round?x=1", "/api/staff/ambassador/round", "/api/staff/ambassador/marks"]) {
      expect(isRoundPath(new URL(path, ORIGIN).pathname), path).toBe(true);
      expect(classify(page(path), ORIGIN), path).toEqual({ kind: "pass", reason: "round" });
      expect(classify(req(path), ORIGIN), path).toEqual({ kind: "pass", reason: "round" });
      expect(classify(req(path, { headers: { rsc: "1" } }), ORIGIN), path).toEqual({ kind: "pass", reason: "round" });
      expect(classify(req(path, { method: "POST" }), ORIGIN), path).toEqual({ kind: "pass", reason: "method" });
      expect(mayStore(`${ORIGIN}${path}`, ORIGIN), path).toBe(false);
    }
    // The Ambassador's other pages are staff pages like any other; a name that only starts like the round is not it.
    expect(isRoundPath("/staff/ambassador/roundup")).toBe(false);
    expect(classify(page("/staff/ambassador/post"), ORIGIN)).toEqual({ kind: "pass", reason: "staff" });
  });

  it("never answers a subscription page or API (network only)", () => {
    expect(classify(page("/ur/subscription"), ORIGIN)).toEqual({ kind: "pass", reason: "subscription" });
    expect(classify(page("/en/subscription/edit/abc"), ORIGIN)).toEqual({ kind: "pass", reason: "subscription" });
    expect(classify(req("/api/subscription/confirm"), ORIGIN)).toEqual({ kind: "pass", reason: "subscription" });
  });

  it("S08.05: keeps R-33 (Ask for a check-in) as a resident page, and never answers or stores a personalised check-in answer (the sign-up's and the edit page's POSTs)", () => {
    for (const lang of LAUNCH_CODES) {
      expect(classify(page(`/${lang}/ready/check-in`), ORIGIN)).toEqual({ kind: "page", lang });
      expect(mayStore(`${ORIGIN}/${lang}/ready/check-in`, ORIGIN)).toBe(true);
    }
    for (const path of ["/api/signup", "/api/subscription/view", "/api/subscription/change"]) {
      expect(classify(req(path, { method: "POST" }), ORIGIN), path).toEqual({ kind: "pass", reason: "method" });
      expect(mayStore(`${ORIGIN}${path}`, ORIGIN), path).toBe(false);
    }
  });

  it("never answers or stores the one-time web link's page (S07.06) in any language, its data request or its three POSTs", () => {
    const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
    for (const lang of LAUNCH_CODES) {
      const path = `/${lang}/subscription/${token}`;
      expect(classify(page(path), ORIGIN), path).toEqual({ kind: "pass", reason: "subscription" });
      expect(classify(req(path, { headers: { rsc: "1" } }), ORIGIN), path).toEqual({ kind: "pass", reason: "subscription" });
      expect(mayStore(`${ORIGIN}${path}`, ORIGIN), path).toBe(false);
      expect(isSubscriptionPath(path), path).toBe(true);
    }
    for (const path of ["/api/subscription/view", "/api/subscription/change", "/api/subscription/delete"]) {
      expect(classify(req(path, { method: "POST" }), ORIGIN), path).toEqual({ kind: "pass", reason: "method" });
      expect(classify(req(path), ORIGIN), path).toEqual({ kind: "pass", reason: "subscription" });
      expect(mayStore(`${ORIGIN}${path}`, ORIGIN), path).toBe(false);
      expect(isSubscriptionPath(path), path).toBe(true);
    }
  });

  it("leaves every map tile, and anything from another origin, to the network and the map page", () => {
    for (const tile of ["https://a.basemaps.cartocdn.com/light_all/15/9161/11958.png", "https://tile.openstreetmap.org/15/1/2.png", "https://tiles.stadiamaps.com/tiles/x/1/2/3.png"]) {
      expect(classify(req(tile), ORIGIN)).toEqual({ kind: "pass", reason: "cross-origin" });
    }
    expect(kind(page("https://other.example/en"))).toBe("pass");
  });

  it("leaves search, the building list, Next's data requests, other API routes and non-GET requests to the network", () => {
    expect(classify(req("/api/search", { method: "POST" }), ORIGIN)).toEqual({ kind: "pass", reason: "method" });
    // S02.15: a usage event is a POST, so the worker never answers or keeps it: it goes to the network as if there were no worker.
    expect(classify(req("/api/metrics", { method: "POST" }), ORIGIN)).toEqual({ kind: "pass", reason: "method" });
    expect(classify(req("/api/metrics"), ORIGIN)).toEqual({ kind: "pass", reason: "not-listed" });
    expect(kind(req("/api/search?q=food"))).toBe("pass");
    expect(kind(req("/api/buildings"))).toBe("pass");
    expect(kind(req("/api/health"))).toBe("pass");
    expect(kind(req("/api/feed/archive?lang=en"))).toBe("pass");
    expect(classify(req("/en/ready", { headers: { rsc: "1" } }), ORIGIN)).toEqual({ kind: "pass", reason: "next-data" });
    expect(classify(page("/en/ready?_rsc=abc"), ORIGIN)).toEqual({ kind: "pass", reason: "next-data" });
    expect(kind(req("/en/directory", { method: "POST", mode: "navigate" }))).toBe("pass");
    expect(kind(req("/en/manifest.webmanifest"))).toBe("pass");
    expect(classify(req("/serwist/sw.js"), ORIGIN)).toEqual({ kind: "pass", reason: "worker" });
    // A language the CVH does not have, and the site's own root, are not resident pages.
    expect(kind(page("/de/ready"))).toBe("pass");
    expect(kind(page("/"))).toBe("pass");
    // The share link's landing (S05.08, /a/{slug}?l={lang}) is the network's: its content follows `?l=`, which a kept copy (keyed without the query) would lose.
    // The alert page it moves to, and the share screen, are resident pages and are kept.
    expect(kind(page("/a/heat-1"))).toBe("pass");
    expect(kind(page("/a/kbcdfghj?l=ur"))).toBe("pass");
    expect(kind(page("/en/alerts/kbcdfghj/share"))).toBe("page");
  });
});

describe("what may ever be stored", () => {
  it("refuses every /staff/** and /api/staff/** response", () => {
    for (const path of ["/staff", "/staff/sign-in", "/staff/directory", "/api/staff/me", "/api/staff/password"]) {
      expect(mayStore(`${ORIGIN}${path}`, ORIGIN), path).toBe(false);
    }
  });

  it("refuses subscription pages and API, other origins (map tiles) and anything not listed", () => {
    expect(mayStore(`${ORIGIN}/en/subscription`, ORIGIN)).toBe(false);
    expect(mayStore(`${ORIGIN}/api/subscription/x`, ORIGIN)).toBe(false);
    expect(mayStore("https://a.basemaps.cartocdn.com/light_all/1/2/3.png", ORIGIN)).toBe(false);
    expect(mayStore(`${ORIGIN}/api/search`, ORIGIN)).toBe(false);
    expect(mayStore(`${ORIGIN}/api/buildings`, ORIGIN)).toBe(false);
    expect(mayStore(`${ORIGIN}/`, ORIGIN)).toBe(false);
    expect(mayStore(`${ORIGIN}/a/kbcdfghj?l=ur`, ORIGIN)).toBe(false);
    expect(mayStore("not a url", ORIGIN)).toBe(false);
  });

  it("allows the resident pages, the feed, the manifest, release files and static files", () => {
    for (const path of ["/en", "/ur/ready/numbers", "/api/feed?lang=en", "/api/directory/manifest", "/api/directory/3/en.json", "/_next/static/x.js", "/icons/icon-192.png"]) {
      expect(mayStore(`${ORIGIN}${path}`, ORIGIN), path).toBe(true);
    }
  });

  it("agrees with classify: nothing the worker passes to the network is storable, except what it never sees", () => {
    const paths = ["/staff/sign-in", "/api/staff/me", "/en/subscription", "/api/subscription/x", "/api/search", "/api/buildings", "/api/health"];
    for (const path of paths) {
      expect(kind(page(path))).toBe("pass");
      expect(mayStore(`${ORIGIN}${path}`, ORIGIN)).toBe(false);
    }
  });
});

describe("versions and cleanup", () => {
  it("names a build's caches after the build", () => {
    expect(pagesCache("abc")).toBe("cvh-pages-abc");
    expect(staticCache("abc")).toBe("cvh-static-abc");
  });

  it("removes other builds' pages and static files, and never the map tiles, the data cache, Serwist's or anyone else's", () => {
    const names = ["cvh-pages-old", "cvh-static-old", "cvh-pages-new", "cvh-static-new", TILE_CACHE_NAME, DATA_CACHE, "serwist-precache-v2-https://cvh.example/", "other"];
    expect(cachesToDelete(names, "new")).toEqual(["cvh-pages-old", "cvh-static-old"]);
    expect(cachesToDelete(names, "new")).not.toContain(TILE_CACHE_NAME);
  });

  it("tells builds apart by their precache list", () => {
    const a = buildIdOf([{ url: "/_next/static/chunks/a.js", revision: null }]);
    const b = buildIdOf([{ url: "/_next/static/chunks/b.js", revision: null }]);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(buildIdOf([{ url: "/_next/static/chunks/a.js", revision: null }])).toBe(a);
    expect(buildIdOf([{ url: "/icons/icon.png", revision: "1" }])).not.toBe(buildIdOf([{ url: "/icons/icon.png", revision: "2" }]));
    expect(buildIdOf(undefined)).toBe("dev");
  });

  it("removes the files of older releases once a newer one is kept", () => {
    const urls = [`${ORIGIN}/api/directory/3/en.json`, `${ORIGIN}/api/directory/3/ur.json`, `${ORIGIN}/api/directory/4/en.json`, `${ORIGIN}/api/feed?lang=en`, `${ORIGIN}/api/directory/manifest`];
    expect(directoryFilesToDelete(urls, 4)).toEqual([`${ORIGIN}/api/directory/3/en.json`, `${ORIGIN}/api/directory/3/ur.json`]);
    expect(directoryFilesToDelete(urls, 3)).toEqual([]);
    expect(releaseOf(`${ORIGIN}/api/directory/manifest`)).toBeNull();
  });

  it("keeps a feed only if it is not older than the newest kept", () => {
    expect(shouldKeepFeed(5, null)).toBe(true);
    expect(shouldKeepFeed(5, 5)).toBe(true);
    expect(shouldKeepFeed(6, 5)).toBe(true);
    expect(shouldKeepFeed(4, 5)).toBe(false);
  });
});

describe("a kept page's title", () => {
  it("reads the first title and decodes what Next escapes", () => {
    expect(titleOf("<html><head><title>Numbers I might need</title></head></html>")).toBe("Numbers I might need");
    expect(titleOf('<title data-x="1">Food &amp; drink &#x27;here&#x27;</title><title>Second</title>')).toBe("Food & drink 'here'");
    expect(titleOf("<html></html>")).toBeNull();
    expect(titleOf("<title>  </title>")).toBeNull();
  });
});
