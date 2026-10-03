// The routes alerts are translated by (S04.02, AD-10): for each language the ordered models, each with its own attempt
// timeout, the language's route deadline, and the check its output must pass. The rows live in `translation_route`
// (config, not code; seeded by migration from the addendum's routing table); this is what a set of rows must add up to
// and how they become a route. Pure.
//
// The attempt timeout and the deadline are provisional until S04.01 replaces them by a later migration from measured
// latency (`source` says which): an attempt timeout is a whole number of seconds, at most 20 s; a language's route
// deadline is the sum of its attempt timeouts, at most 30 s, counted from the start of that language's translation.
import type { LangCode } from "@/contracts/lang";
import { LANG_CODES } from "@/contracts/lang";
import { CHECK_SCRIPTS, type CheckScript, type LanguageCheck } from "./alertChecks";

/** The most one attempt may take (the definitions' "at most 20 s"). */
export const MAX_ATTEMPT_TIMEOUT_MS = 20_000;
/** The most a language's attempts may add up to (the definitions' "at most 30 s"). */
export const MAX_ROUTE_DEADLINE_MS = 30_000;

/** The languages a model translates into: every launch language except English, which is the source, and zh-Hant, which OpenCC converts from zh. */
export type RouteLang = Exclude<LangCode, "en" | "zh-Hant">;
export const ROUTE_LANGS = LANG_CODES.filter((lang): lang is RouteLang => lang !== "en" && lang !== "zh-Hant");

/** `provisional`: a value chosen before it was measured. `measured`: set by S04.01's latency report or a later re-measurement. */
export type RouteSource = "provisional" | "measured";

/** One stored row of `translation_route`: a language's route position. */
export interface RouteRow {
  lang: string;
  position: number;
  model: string;
  attemptTimeoutMs: number;
  eldCode: string | null;
  script: string;
  markerLetters: string;
  excludedLetters: string;
  source: string;
}

export interface RoutePosition {
  /** 1 is the first choice. */
  position: number;
  model: string;
  attemptTimeoutMs: number;
  source: RouteSource;
}

export interface TranslationRoute {
  lang: RouteLang;
  check: LanguageCheck;
  /** In order: the first choice first. */
  positions: readonly RoutePosition[];
  /** The sum of the attempt timeouts. */
  deadlineMs: number;
}

/** A set of rows that is not a route: a bug in the configuration, never an input. Names the language, never text. */
export class RouteConfigError extends Error {
  override name = "RouteConfigError";
  constructor(
    readonly lang: string,
    readonly problem: string,
  ) {
    super(`translation_route ${lang}: ${problem}`);
  }
}

const isRouteLang = (lang: string): lang is RouteLang => (ROUTE_LANGS as readonly string[]).includes(lang);
const isScript = (script: string): script is CheckScript => (CHECK_SCRIPTS as readonly string[]).includes(script);
const checkKey = (row: RouteRow) => JSON.stringify([row.eldCode, row.script, row.markerLetters, row.excludedLetters]);

/** The sum of a language's attempt timeouts: its route deadline. */
export const routeDeadlineMs = (positions: readonly { attemptTimeoutMs: number }[]): number => positions.reduce((sum, position) => sum + position.attemptTimeoutMs, 0);

/**
 * Turns the stored rows into routes, one per language that has rows, in the order of ROUTE_LANGS. Refuses (RouteConfigError)
 * rows that are not a route, so a bad migration fails loudly instead of translating by a route nobody meant: an unknown
 * language or script, positions repeated, a model twice in one route, an attempt timeout that is not whole seconds or is
 * over 20 s, a route deadline over 30 s, and rows of one language that disagree about its check.
 */
export function buildRoutes(rows: readonly RouteRow[]): TranslationRoute[] {
  const byLang = new Map<RouteLang, RouteRow[]>();
  for (const row of rows) {
    if (!isRouteLang(row.lang)) throw new RouteConfigError(row.lang, "not a language alerts are translated into");
    byLang.set(row.lang, [...(byLang.get(row.lang) ?? []), row]);
  }
  const routes: TranslationRoute[] = [];
  for (const lang of ROUTE_LANGS) {
    const own = byLang.get(lang);
    if (!own) continue;
    const sorted = [...own].sort((a, b) => a.position - b.position);
    const first = sorted[0]!;
    if (!isScript(first.script)) throw new RouteConfigError(lang, `unknown script ${first.script}`);
    if (new Set(sorted.map(checkKey)).size !== 1) throw new RouteConfigError(lang, "its rows disagree about the check");
    if (new Set(sorted.map((row) => row.position)).size !== sorted.length) throw new RouteConfigError(lang, "a position is repeated");
    if (new Set(sorted.map((row) => row.model)).size !== sorted.length) throw new RouteConfigError(lang, "a model is in the route twice");
    const positions = sorted.map((row): RoutePosition => {
      if (!Number.isInteger(row.position) || row.position < 1) throw new RouteConfigError(lang, "a position is not a positive whole number");
      const ms = row.attemptTimeoutMs;
      if (!Number.isInteger(ms) || ms <= 0 || ms % 1000 !== 0) throw new RouteConfigError(lang, "an attempt timeout is not a whole number of seconds");
      if (ms > MAX_ATTEMPT_TIMEOUT_MS) throw new RouteConfigError(lang, `an attempt timeout is over ${MAX_ATTEMPT_TIMEOUT_MS / 1000} s`);
      if (row.source !== "provisional" && row.source !== "measured") throw new RouteConfigError(lang, `unknown source ${row.source}`);
      return { position: row.position, model: row.model, attemptTimeoutMs: ms, source: row.source };
    });
    const deadlineMs = routeDeadlineMs(positions);
    if (deadlineMs > MAX_ROUTE_DEADLINE_MS) throw new RouteConfigError(lang, `the route deadline is over ${MAX_ROUTE_DEADLINE_MS / 1000} s`);
    routes.push({
      lang,
      check: { eldCode: first.eldCode, script: first.script, markerLetters: first.markerLetters, excludedLetters: first.excludedLetters },
      positions,
      deadlineMs,
    });
  }
  return routes;
}
