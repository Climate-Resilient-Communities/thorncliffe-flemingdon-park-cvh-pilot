import { readdirSync, statSync } from "node:fs";
import path from "node:path";

// Every URL a resident can reach, read from the app's own folders (src/app/[lang]/**/page.tsx, src/app/a/**/page.tsx, the root page and
// src/app/api/**/route.ts but for the staff, job and Twilio ones), so a resident route or API added later is covered by the drill isolation test
// the moment it exists, with nothing to remember. A dynamic segment is filled with the value `samples` gives its name.

export interface RouteKind {
  /** The URL path with its dynamic segments filled. */
  url: string;
  /** `page` for a page, `api` for a route handler. */
  kind: "page" | "api";
  /** The source file, relative to the repository, so a failure names what to look at. */
  file: string;
}

const APP = path.join(__dirname, "..", "..", "src", "app");
const NOT_RESIDENT_API = /^api\/(?:staff|jobs|twilio)(?:\/|$)/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * @param languages the values `[lang]` takes (each route is listed once per language)
 * @param samples the value of each dynamic segment by name; one not named is "sample"
 */
export function residentRoutes(languages: readonly string[], samples: Readonly<Record<string, string>>): RouteKind[] {
  const files = walk(APP).filter((file) => /\/(?:page\.tsx?|route\.ts)$/.test(file));
  const routes: RouteKind[] = [];
  for (const file of files) {
    const relative = path.relative(APP, path.dirname(file)).split(path.sep);
    const segments = relative.filter((segment) => !/^\(.*\)$/.test(segment));
    const joined = segments.join("/");
    const isApi = /\/route\.ts$/.test(file);
    // The staff surface, the jobs and the Twilio webhooks are not a resident's: everything else under src/app is.
    if (joined === "staff" || joined.startsWith("staff/") || NOT_RESIDENT_API.test(joined)) continue;
    const expand = (lang: string) =>
      "/" +
      segments
        .map((segment) => {
          if (segment === "[lang]") return lang;
          const name = segment.match(/^\[(?:\.\.\.)?(\w+)\]$/)?.[1];
          if (!name) return segment;
          return samples[name] ?? (segment.startsWith("[...") ? "sample/deeper" : "sample");
        })
        .filter(Boolean)
        .join("/");
    const relativeFile = path.relative(path.join(__dirname, "..", ".."), file);
    const perLanguage = segments.includes("[lang]");
    for (const lang of perLanguage ? languages : [languages[0]]) routes.push({ url: expand(lang), kind: isApi ? "api" : "page", file: relativeFile });
  }
  return routes.sort((a, b) => a.url.localeCompare(b.url));
}
