// Routes from the rows of `translation_route` (S04.02): the models in order, each position's own attempt timeout, and the
// route deadline that is the sum of them, at most 30 s. The seed's own rows are in alertFixtures.ts.
import { describe, expect, it } from "vitest";
import { AYA_FIRE, COMMAND_A, NORTH, SEEDED_ROUTES, SEEDED_ROUTE_ROWS } from "./alertFixtures";
import { MAX_ATTEMPT_TIMEOUT_MS, MAX_ROUTE_DEADLINE_MS, ROUTE_LANGS, RouteConfigError, buildRoutes, routeDeadlineMs, type RouteRow } from "./alertRoutes";

const row = (change: Partial<RouteRow> = {}): RouteRow => ({
  lang: "ur",
  position: 1,
  model: NORTH,
  attemptTimeoutMs: 10_000,
  eldCode: "ur",
  script: "arabic",
  markerLetters: "",
  excludedLetters: "",
  source: "provisional",
  ...change,
});

describe("the routes as seeded from the addendum's routing table", () => {
  it("has a route for every language a model translates into, none for English or zh-Hant", () => {
    expect(SEEDED_ROUTES.map((route) => route.lang).sort()).toEqual([...ROUTE_LANGS].sort());
    expect(ROUTE_LANGS).not.toContain("en");
    expect(ROUTE_LANGS).not.toContain("zh-Hant");
  });

  it("orders the models as the addendum does", () => {
    const models = (lang: string) => SEEDED_ROUTES.find((route) => route.lang === lang)!.positions.map((position) => position.model);
    expect(models("ps")).toEqual([NORTH]);
    expect(models("prs")).toEqual([NORTH, COMMAND_A]);
    expect(models("fr")).toEqual([COMMAND_A, NORTH]);
    expect(models("ur")).toEqual([NORTH, AYA_FIRE]);
    expect(models("gu")).toEqual([AYA_FIRE, NORTH]);
  });

  it("gives each route a deadline that is the sum of its attempt timeouts, never over 30 s", () => {
    for (const route of SEEDED_ROUTES) {
      expect(route.deadlineMs).toBe(routeDeadlineMs(route.positions));
      expect(route.deadlineMs).toBeLessThanOrEqual(MAX_ROUTE_DEADLINE_MS);
      for (const position of route.positions) expect(position.attemptTimeoutMs).toBeLessThanOrEqual(MAX_ATTEMPT_TIMEOUT_MS);
    }
  });

  it("marks every value provisional", () => {
    expect(SEEDED_ROUTE_ROWS.every((r) => r.source === "provisional")).toBe(true);
    expect(SEEDED_ROUTES.every((route) => route.positions.every((position) => position.source === "provisional"))).toBe(true);
  });
});

describe("buildRoutes", () => {
  it("puts a language's positions in order whatever order the rows come in, with the deadline as the sum", () => {
    const [route] = buildRoutes([row({ position: 2, model: "second", attemptTimeoutMs: 7000 }), row({ position: 1, model: "first", attemptTimeoutMs: 3000 })]);

    expect(route!.positions.map((position) => [position.position, position.model, position.attemptTimeoutMs])).toEqual([
      [1, "first", 3000],
      [2, "second", 7000],
    ]);
    expect(route!.deadlineMs).toBe(10_000);
    expect(route!.check).toEqual({ eldCode: "ur", script: "arabic", markerLetters: "", excludedLetters: "" });
  });

  it("keeps each position's own source, so one measured timeout beside a provisional one is shown as it is", () => {
    const [route] = buildRoutes([row({ source: "measured" }), row({ position: 2, model: "second" })]);

    expect(route!.positions.map((position) => position.source)).toEqual(["measured", "provisional"]);
  });

  it("allows a deadline of exactly 30 s and an attempt of exactly 20 s", () => {
    expect(buildRoutes([row({ attemptTimeoutMs: 20_000 }), row({ position: 2, model: "second", attemptTimeoutMs: 10_000 })])[0]!.deadlineMs).toBe(30_000);
  });

  it.each([
    ["a language alerts are not translated into", [row({ lang: "en" })], /not a language alerts are translated into/],
    ["zh-Hant, which OpenCC converts", [row({ lang: "zh-Hant" })], /not a language alerts are translated into/],
    ["an unknown script", [row({ script: "klingon" })], /unknown script/],
    ["a position repeated", [row(), row({ model: "second" })], /position is repeated/],
    ["a model twice in a route", [row(), row({ position: 2 })], /model is in the route twice/],
    ["rows that disagree about the check", [row(), row({ position: 2, model: "second", eldCode: "fa" })], /disagree about the check/],
    ["an attempt timeout that is not whole seconds", [row({ attemptTimeoutMs: 2500 })], /whole number of seconds/],
    ["an attempt timeout of zero", [row({ attemptTimeoutMs: 0 })], /whole number of seconds/],
    ["an attempt timeout over 20 s", [row({ attemptTimeoutMs: 21_000 })], /over 20 s/],
    ["a route deadline over 30 s", [row({ attemptTimeoutMs: 20_000 }), row({ position: 2, model: "second", attemptTimeoutMs: 11_000 })], /route deadline is over 30 s/],
    ["a source that is neither provisional nor measured", [row({ source: "guessed" })], /unknown source/],
    ["a position of zero", [row({ position: 0 })], /positive whole number/],
  ])("refuses %s, naming the language and never any text", (_name, rows, message) => {
    const failure = (() => {
      try {
        buildRoutes(rows);
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(RouteConfigError);
    expect((failure as Error).message).toMatch(message);
  });

  it("returns routes in the order of ROUTE_LANGS and none for a language without rows", () => {
    const routes = buildRoutes([row({ lang: "fr", eldCode: "fr", script: "latin" }), row()]);

    expect(routes.map((route) => route.lang)).toEqual(["ur", "fr"]);
  });
});
