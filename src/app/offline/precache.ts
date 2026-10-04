// What the service worker precaches (S02.12). The build writes, for every page, a client-reference manifest that names the
// scripts and styles the page loads. A resident phone needs those of the resident pages (/, /{lang}/**) and nothing of the
// Hub (/staff/**). The map page's chunks are kept: a map page kept from before a deploy is fetched again at install and must
// find its scripts offline. Plain functions, unit-tested (precache.test.ts); the
// route (src/app/serwist/[path]/route.ts) reads the build's folder with them.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// One chunk pattern for the manifests and for the precache entries: any file name that holds no "/" or quote.
const CHUNK_PATH = String.raw`static\/chunks\/[^/"'\s\\]+\.(?:js|css)`;
const CHUNK = new RegExp(CHUNK_PATH, "g");
const CHUNK_URL = new RegExp(`${CHUNK_PATH}$`);
// The client-reference manifest names a page's own scripts and styles; its build-manifest.json the framework's that every page loads.
const MANIFEST_FILE = /(?:_client-reference-manifest\.js|^build-manifest\.json)$/;

/** Whether the route at `relative` (a folder under .next/server/app, with `/`) is a resident page's (or the shared shell's). */
function isResidentRoute(relative: string): boolean {
  return !relative.startsWith("staff/") && !relative.startsWith("api/");
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
 * without those only the Hub loads. Null when the build left no manifest to read (a development run), so the
 * caller keeps every file rather than none.
 */
export function residentChunks(appServerDir: string): Set<string> | null {
  let found = false;
  const resident = new Set<string>();
  try {
    for (const { relative, file } of manifests(appServerDir)) {
      found = true;
      if (!isResidentRoute(relative)) continue;
      for (const chunk of readFileSync(file, "utf8").match(CHUNK) ?? []) resident.add(chunk);
    }
  } catch {
    return null;
  }
  return found && resident.size > 0 ? resident : null;
}

/**
 * `chunks` and every chunk they load by import() (named inside their text, "static/chunks/x.js", which no page manifest lists:
 * Leaflet's, for one), followed until no new chunk turns up. A chunk file that cannot be read is left as it is.
 */
export function withDynamicChunks(chunks: Set<string>, distDir: string): Set<string> {
  const all = new Set(chunks);
  const queue = [...chunks];
  for (let chunk = queue.pop(); chunk !== undefined; chunk = queue.pop()) {
    let text: string;
    try {
      text = readFileSync(path.join(distDir, chunk), "utf8");
    } catch {
      continue;
    }
    for (const named of text.match(CHUNK) ?? []) {
      if (!all.has(named)) {
        all.add(named);
        queue.push(named);
      }
    }
  }
  return all;
}

/** The chunk name in a precache entry's url (".next/static/chunks/x.js", "/_next/static/chunks/x.js"), or null for any other file. */
export function chunkOf(url: string): string | null {
  const match = url.match(CHUNK_URL);
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

/**
 * The filter for the build's precache list, and the warnings Serwist prints with the count: when the build left nothing to read
 * (a development run, or a manifest renamed by a Next upgrade) every file is kept, and the warning says why.
 */
export function precacheFilter(distDir: string): { keeps: (url: string) => boolean; warnings: string[] } {
  const listed = residentChunks(path.join(distDir, "server", "app"));
  const resident = listed === null ? null : withDynamicChunks(listed, distDir);
  const warnings = resident === null ? [`No client-reference manifest to read under ${distDir}/server/app: every script and style is precached, the Hub's and the map's too.`] : [];
  return { keeps: (url) => keepsEntry(url, resident), warnings };
}
