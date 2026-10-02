// What test/staff-guard.test.ts checks, found on disk: every file of the app router that serves a
// URL under /staff or /api/staff, wherever it sits (route groups included), and every server
// action those files can reach. Pure functions over a directory, so the test can run them on
// fixtures as well as on src/app.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SOURCE = /\.(tsx?|jsx?|mjs|cjs)$/;
const TEST = /\.test\.(tsx?|jsx?)$/;

/** Other route files of the app router: they render or answer without going through a guard. */
const UNGUARDABLE = /^(template|default|loading|error|global-error|not-found|forbidden|unauthorized)\.(tsx?|jsx?)$/;
/** Metadata routes and files (icons, social images, sitemap, robots, manifest): served as their own URLs, unguarded. */
const METADATA = [/^(icon|apple-icon|opengraph-image|twitter-image)\d*(\.alt)?\.[a-z0-9]+$/i, /^(sitemap|robots|manifest|favicon)\.[a-z0-9]+$/i];
/** Exports Next.js calls on a page or layout outside the default export, so outside its guard. */
const GENERATED = ["generateMetadata", "generateViewport", "generateStaticParams", "generateImageMetadata", "generateSitemaps"];

export interface StaffSurface {
  appDir: string;
  /** Every file serving a staff URL (route files and the files beside them), tests excluded. */
  files: string[];
  pages: string[];
  handlers: string[];
  layouts: string[];
  /** Route files no guard can wrap (templates, loading and error pages and the like). */
  unguardable: string[];
  /** Metadata routes and files under a staff URL. */
  metadata: string[];
  /** Files with `"use server"` at the top that staff files import, directly or not, anywhere under the source root. */
  actionFiles: string[];
  /** Staff files, or files they import, with a `"use server"` directive inside a function (an inline server action). */
  inlineActions: string[];
  /** Staff pages and layouts exporting generateMetadata or another function Next.js calls outside the guard. */
  generatedExports: { file: string; name: string }[];
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** The URL path a file under the app directory serves: route groups, slots and interception markers removed. */
export function routePathOf(appDir: string, file: string): string {
  const segments = path
    .relative(appDir, path.dirname(file))
    .split(path.sep)
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment) && !segment.startsWith("@"))
    .map((segment) => segment.replace(/^(\(\.{1,3}\))+/, ""));
  return `/${segments.join("/")}`;
}

/** True for a URL path under /staff or /api/staff. */
export function isStaffPath(route: string): boolean {
  return /^\/(api\/)?staff(\/|$)/.test(route);
}

/** Drops leading comments and blank space, so a file-level directive is the text's start. */
function withoutLeadingComments(text: string): string {
  let rest = text;
  for (;;) {
    const trimmed = rest.replace(/^\s+/, "");
    if (trimmed.startsWith("//")) rest = trimmed.slice(trimmed.indexOf("\n") === -1 ? trimmed.length : trimmed.indexOf("\n"));
    else if (trimmed.startsWith("/*")) rest = trimmed.slice(trimmed.indexOf("*/") + 2);
    else return trimmed;
  }
}

const USE_SERVER = /^["']use server["']\s*;?/;

/** A file whose first statement is `"use server"`: every export is a server action. */
export function isActionFile(text: string): boolean {
  return USE_SERVER.test(withoutLeadingComments(text));
}

/** A `"use server"` directive anywhere but at the top of the file: an inline server action. */
export function hasInlineAction(text: string): boolean {
  const body = withoutLeadingComments(text).replace(USE_SERVER, "");
  return /["']use server["']/.test(body);
}

/** Function exports Next.js calls on a page or layout outside its guard (generateMetadata and the like). */
export function generatedExportsOf(text: string): string[] {
  return GENERATED.filter((name) =>
    new RegExp(`export\\s+(async\\s+)?function\\s*\\*?\\s*${name}\\b|export\\s+(const|let|var)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(text),
  );
}

/** The modules a file imports (static, dynamic and re-exports), as written. */
function importsOf(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) found.push(match[1]);
  return found;
}

/** Resolves a relative or `@/` import to a source file under srcDir; null for packages and anything else. */
function resolveImport(srcDir: string, from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(srcDir, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;
  const candidates = [base, ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].map((ext) => base + ext), ...["index.ts", "index.tsx", "index.js"].map((name) => path.join(base, name))];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

/** Finds the staff surface of an app directory; imports are followed within srcDir. */
export function findStaffSurface(appDir: string, srcDir: string): StaffSurface {
  const all = walk(appDir).filter((file) => !TEST.test(file));
  const staff = all.filter((file) => isStaffPath(routePathOf(appDir, file)));
  const sources = staff.filter((file) => SOURCE.test(file));
  const named = (pattern: RegExp) => sources.filter((file) => pattern.test(path.basename(file)));

  // Every source file a staff file reaches through its imports, staff files included.
  const reached = new Set<string>();
  const queue = [...sources];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (reached.has(file)) continue;
    reached.add(file);
    for (const specifier of importsOf(readFileSync(file, "utf8"))) {
      const target = resolveImport(srcDir, file, specifier);
      if (target && SOURCE.test(target) && !reached.has(target)) queue.push(target);
    }
  }
  const text = (file: string) => readFileSync(file, "utf8");
  const reachedFiles = [...reached].sort();

  return {
    appDir,
    files: staff,
    pages: named(/^page\.(tsx?|jsx?)$/),
    handlers: named(/^route\.(tsx?|jsx?)$/),
    layouts: named(/^layout\.(tsx?|jsx?)$/),
    unguardable: named(UNGUARDABLE),
    metadata: staff.filter((file) => METADATA.some((pattern) => pattern.test(path.basename(file)))),
    actionFiles: reachedFiles.filter((file) => isActionFile(text(file))),
    inlineActions: reachedFiles.filter((file) => hasInlineAction(text(file))),
    generatedExports: named(/^(page|layout)\.(tsx?|jsx?)$/).flatMap((file) => generatedExportsOf(text(file)).map((name) => ({ file, name }))),
  };
}

/** What the guard cannot cover, found without importing anything; empty when the surface is sound. */
export function staffSurfaceProblems(surface: StaffSurface): string[] {
  const shown = (file: string) => path.relative(path.dirname(surface.appDir), file);
  return [
    ...surface.unguardable.map((file) => `${shown(file)}: a route file the guard cannot wrap`),
    ...surface.handlers.filter((file) => !routePathOf(surface.appDir, file).startsWith("/api/")).map((file) => `${shown(file)}: a route handler outside /api/staff`),
    ...surface.metadata.map((file) => `${shown(file)}: a metadata route under a staff URL, served without the guard`),
    ...surface.inlineActions.map((file) => `${shown(file)}: an inline "use server" action; put it in a "use server" file built with staffAction`),
    ...surface.generatedExports.map(({ file, name }) => `${shown(file)}: exports ${name}, which Next.js calls outside the guard`),
  ];
}
