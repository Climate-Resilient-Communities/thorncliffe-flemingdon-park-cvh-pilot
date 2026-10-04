// What the service worker precaches (S02.12). The build writes, for every page, a client-reference manifest that names the
// scripts and styles the page loads. A resident phone needs those of the resident pages (/, /{lang}/**) and nothing of the
// Hub (/staff/**) or of the map page alone: Leaflet and the map's own chunks are fetched when the map is opened and are kept
// then (a cache-first static file, offline/rules.ts), as the tiles are. Plain functions, unit-tested (precache.test.ts); the
// route (src/app/serwist/[path]/route.ts) reads the build's folder with them.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const CHUNK = /static\/chunks\/[A-Za-z0-9_.~-]+\.(?:js|css)/g;
// The client-reference manifest names a page's own scripts and styles; its build-manifest.json the framework's that every page loads.
const MANIFEST_FILE = /(?:_client-reference-manifest\.js|^build-manifest\.json)$/;

/** Whether the route at `relative` (a folder under .next/server/app, with `/`) is a resident page's (or the shared shell's). */
function isResidentRoute(relative: string): boolean {
  return !relative.startsWith("staff/") && !relative.startsWith("api/");
}

/** Whether the route is the map page: its own chunks are left to the page (a chunk another resident page loads is kept for that page). */
function isMapRoute(relative: string): boolean {
  return relative.startsWith("[lang]/map/");
}

function* manifests(dir: string, base = ""): Generator<{ relative: string; file: string }> {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    const relative = base ? `${base}/${name}` : name;
    if (statSync(file).isDirectory()) yield* manifests(file, relative);
    else if (MANIFEST_FILE.test(name)) yield { relative, file };
  }
}

/**
 * The scripts and styles ("static/chunks/x.js") the resident pages load, from the manifests under `<distDir>/server/app`,
 * without those only the map page and the Hub load. Null when the build left no manifest to read (a development run), so the
 * caller keeps every file rather than none.
 */
export function residentChunks(appServerDir: string): Set<string> | null {
  let found = false;
  const resident = new Set<string>();
  try {
    for (const { relative, file } of manifests(appServerDir)) {
      found = true;
      if (!isResidentRoute(relative) || isMapRoute(relative)) continue;
      for (const chunk of readFileSync(file, "utf8").match(CHUNK) ?? []) resident.add(chunk);
    }
  } catch {
    return null;
  }
  return found && resident.size > 0 ? resident : null;
}

/** The chunk name in a precache entry's url (".next/static/chunks/x.js", "/_next/static/chunks/x.js"), or null for any other file. */
export function chunkOf(url: string): string | null {
  const match = url.match(/static\/chunks\/[^/]+\.(?:js|css)$/);
  return match ? match[0] : null;
}

/** Whether a precache entry stays: not a chunk (an icon), a chunk a resident page loads, or the build's runtime loader. */
export function keepsEntry(url: string, resident: Set<string> | null): boolean {
  if (resident === null) return true;
  const chunk = chunkOf(url);
  if (chunk === null) return true;
  // The loader every page runs first is always kept, whether or not a page's manifest names it.
  return resident.has(chunk) || /^static\/chunks\/turbopack-[^/]+\.js$/.test(chunk);
}
