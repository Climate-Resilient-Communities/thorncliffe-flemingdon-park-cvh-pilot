import { DEFAULT_LANGUAGE, isLaunchCode, type LaunchCode } from "./languages";

// Something that looks like a language tag (xx, xxx, xx-Hant, xx-CA): a first path segment of this shape that
// is not a launch language is an unknown language code, not another page.
const LANGUAGE_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

// First segments that are routes of the app, not languages, though they have the shape of a code.
const RESERVED_SEGMENTS = new Set(["api"]);

/** Splits "/ur/map/x" into { first: "ur", rest: "/map/x" }; rest is "" for "/ur" and "/". */
function split(pathname: string) {
  const match = /^\/([^/]*)(\/.*)?$/.exec(pathname);
  return { first: match?.[1] ?? "", rest: match?.[2] ?? "" };
}

/** The same page in another language: "/ur/map" with "en" is "/en/map". The path after the code is kept. */
export function pathInLanguage(pathname: string, code: LaunchCode): string {
  const { first, rest } = split(pathname);
  const hasLanguage = isLaunchCode(first) || LANGUAGE_SHAPE.test(first);
  const path = hasLanguage ? rest : first ? `/${first}${rest}` : "";
  return `/${code}${path}`;
}

/**
 * Where a request for an unknown language code goes: the same path under /en/ ("/xx/map" is "/en/map").
 * Null when the path needs no redirect: it has a launch language, or its first segment is not language-shaped.
 */
export function unknownLanguageRedirect(pathname: string): string | null {
  const { first, rest } = split(pathname);
  if (isLaunchCode(first) || RESERVED_SEGMENTS.has(first) || !LANGUAGE_SHAPE.test(first)) return null;
  return `/${DEFAULT_LANGUAGE}${rest}`;
}
