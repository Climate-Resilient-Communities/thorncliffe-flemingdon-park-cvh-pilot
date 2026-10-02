// Every response under /staff and /api/staff carries Cache-Control: no-store (AD-1, S01.09). next.config.ts says it with
// two header rules; this checks, from the files on disk, that every staff page and API route falls under one of them, so a
// route added outside /staff or /api/staff, or a changed rule, fails here. e2e/staff/hub-shell.spec.ts requests each of
// the same routes from the production build and reads the header itself.
import { readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { LAUNCH_CODES } from "../src/i18n/languages";

// The matcher Next itself compiles a header `source` with (it ships no types).
const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as { pathToRegexp: (source: string) => RegExp };
const APP = path.join(__dirname, "..", "src", "app");
const allRules = (await nextConfig.headers?.()) ?? [];
/** The rules of the staff surface; the resident building page has its own (S02.08), checked below. */
const rules = allRules.filter((rule) => /staff/.test(rule.source));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** The URL path of a page or route file: its directory under src/app, without route groups. */
const urlOf = (file: string) =>
  "/" +
  path
    .relative(APP, path.dirname(file))
    .split(path.sep)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join("/");

/** A header `source` of the form /prefix/:path* as a test on a URL path: the prefix itself or anything below it. */
function matcher(source: string): RegExp {
  expect(source).toMatch(/^\/[\w/-]+\/:path\*$/);
  const prefix = source.replace(/\/:path\*$/, "");
  return new RegExp(`^${prefix}(?:/.*)?$`);
}

const covered = (url: string) => rules.some((rule) => matcher(rule.source).test(url));
const routeFiles = (dir: string) => walk(dir).filter((file) => /\/(?:page|route)\.tsx?$/.test(file));

describe("next.config.ts headers", () => {
  it("are exactly the two rules for the staff surface, each setting Cache-Control: no-store and nothing else", () => {
    expect(rules.map((rule) => rule.source).sort()).toEqual(["/api/staff/:path*", "/staff/:path*"]);
    for (const rule of rules) expect(rule.headers, rule.source).toEqual([{ key: "Cache-Control", value: "no-store" }]);
  });

  it("match /staff itself, any path below it, and the same under /api/staff, and nothing else", () => {
    for (const url of ["/staff", "/staff/people", "/staff/a/b/c", "/api/staff", "/api/staff/me", "/api/staff/a/b"]) expect(covered(url), url).toBe(true);
    for (const url of ["/", "/en", "/api/health", "/staffing", "/api/staffing/x", "/en/staff"]) expect(covered(url), url).toBe(false);
  });

  it("give the public resident pages (the building page, Be ready, the guides and the numbers, and only them) a shared-cache lifetime of 5 minutes plus 1 minute stale, never no-store", () => {
    const others = allRules.filter((rule) => !rules.includes(rule));
    expect(others.map((rule) => rule.source)).toEqual([`/:lang(${LAUNCH_CODES.join("|")})/buildings/:rsn`, `/:lang(${LAUNCH_CODES.join("|")})/ready/:guide?`]);
    for (const rule of others) expect(rule.headers, rule.source).toEqual([{ key: "Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=60" }]);
  });

  it("let no rule that is not a staff rule match any /staff or /api path, so the public cache header never reaches the staff surface or an API", () => {
    const others = allRules.filter((rule) => !rules.includes(rule));
    const onDisk = [...routeFiles(path.join(APP, "staff")), ...routeFiles(path.join(APP, "api"))].map(urlOf);
    const lookalikes = [
      "/staff",
      "/staff/buildings/x",
      "/staff/buildings/4154146",
      "/api/buildings/x",
      "/api/buildings/4154146",
      "/api/staff/buildings/x",
      "/api/health",
      "/api/en/buildings/x",
      "/staff/ready",
      "/staff/ready/numbers",
      "/api/ready",
      "/api/ready/power",
      "/api/staff/ready/numbers",
      "/api/en/ready/power",
      "/xx/ready/power",
    ];

    expect(onDisk.length).toBeGreaterThan(8);
    for (const rule of others) {
      const matches = pathToRegexp(rule.source);
      for (const url of [...onDisk, ...lookalikes]) expect(matches.test(url), `${rule.source} must not match ${url}`).toBe(false);
    }
  });

  it("pin each public rule to the pages it is for, in every launch language", () => {
    const [building, ready] = allRules.filter((rule) => !rules.includes(rule));
    for (const code of LAUNCH_CODES) {
      expect(pathToRegexp(building.source).test(`/${code}/buildings/4154146`), code).toBe(true);
      for (const page of ["ready", "ready/power", "ready/numbers"]) expect(pathToRegexp(ready.source).test(`/${code}/${page}`), `${code} ${page}`).toBe(true);
    }
  });

  it("cover every staff page and API route on disk", () => {
    const routes = [...routeFiles(path.join(APP, "staff")), ...routeFiles(path.join(APP, "api", "staff"))].map(urlOf);

    expect(routes.length).toBeGreaterThan(8);
    for (const route of routes) expect(covered(route), route).toBe(true);
  });

  it("leave no page or route file whose path is a staff path outside src/app/staff and src/app/api/staff", () => {
    const staffPaths = routeFiles(APP)
      .map(urlOf)
      .filter((url) => /^\/(?:api\/)?staff(?:\/|$)/.test(url));
    const underStaffDirs = [...routeFiles(path.join(APP, "staff")), ...routeFiles(path.join(APP, "api", "staff"))].map(urlOf);

    expect(staffPaths.sort()).toEqual(underStaffDirs.sort());
  });
});
