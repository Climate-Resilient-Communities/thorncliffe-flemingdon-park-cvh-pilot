// What POST /api/search says about why it could not answer, apart from the search's own failures (those are in
// src/modules/directory/application/search.test.ts): the limiter that could not count, the route's hard deadline, and an
// error nobody expected. Each is told to the app with a safe classification (`timed_out`, a Postgres SQLSTATE, a class name, a
// schema path) and written as one log line, and never carries an error's message, the client's address or the question.
// The hard deadline's own behaviour (when it fires, what it cancels) is in handler.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { SearchErrorSchema } from "@/contracts/search";
import { SearchFailure, type SearchService } from "@/modules/directory";
import { classifyLimiterError, searchResponse, type SearchRouteDeps } from "./handler";

const QUESTION = { q: "my private question about 203.0.113.9", lang: "en" };
const ADDRESS = "203.0.113.9";

/** A search that never answers. */
const stuck: SearchService = { search: () => new Promise(() => undefined), has: async () => true };

describe("what the route says about why it could not answer", () => {
  let logged: MockInstance<typeof console.error>;
  let told: { limiter: [number, string][]; deadline: [number, string][] };
  let deferred: Promise<unknown>[];

  beforeEach(() => {
    logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    told = { limiter: [], deadline: [] };
    deferred = [];
  });
  afterEach(() => logged.mockRestore());

  const lines = () => logged.mock.calls.map((c) => c.join(" "));

  function route(extra: Partial<SearchRouteDeps> = {}): SearchRouteDeps {
    return {
      search: () => stuck,
      limiter: () => ({ check: async () => ({ allowed: true }) }),
      client: () => ADDRESS,
      onLimiterFailure: async (ms, error) => void told.limiter.push([ms, error]),
      onDeadline: async (ms, error) => void told.deadline.push([ms, error]),
      defer: (work) => void deferred.push(work),
      ...extra,
    };
  }

  async function post(deps: SearchRouteDeps, body: unknown = QUESTION) {
    const response = await searchResponse(deps, new Request("https://x.test/api/search", { method: "POST", body: JSON.stringify(body) }));
    await Promise.all(deferred);
    return response;
  }

  const answered = async (response: Response) => SearchErrorSchema.parse(await response.json()).error.code;

  describe("a rate limiter that could not count", () => {
    it("is classified by its SQLSTATE, else its class name, else unknown, never its message, and one line is written", async () => {
      class PostgresLikeError extends Error {}
      const thrown: unknown[] = [
        Object.assign(new Error(`permission denied for table rate_limit ${ADDRESS}`), { code: "42501" }),
        new PostgresLikeError("secret message"),
        Object.assign(new Error("x"), { code: "ECONNREFUSED" }),
        "a string",
        Object.create(null),
      ];

      for (const error of thrown) {
        const response = await post(route({ limiter: () => ({ check: async () => Promise.reject(error) }) }));
        expect(response.status).toBe(503);
        expect(await answered(response)).toBe("search_unavailable");
      }

      expect(told.limiter.map(([, error]) => error)).toEqual(["42501", "PostgresLikeError", "Error", "unknown", "unknown"]);
      expect(lines().map((l) => l.replace(/ ms=\d+$/, ""))).toEqual([
        "search.rate_limit_failed code=42501",
        "search.rate_limit_failed code=PostgresLikeError",
        "search.rate_limit_failed code=Error",
        "search.rate_limit_failed code=unknown",
        "search.rate_limit_failed code=unknown",
      ]);
      expect(JSON.stringify([told, lines()])).not.toMatch(/secret|203\.0\.113|permission denied|private/);
    });

    it("is classified timed_out when it had not answered at the handler's own budget for it", async () => {
      const response = await post(route({ limiter: () => ({ check: () => new Promise(() => undefined) }), limiterBudgetMs: 20 }));

      expect(response.status).toBe(503);
      expect(told.limiter).toEqual([[expect.any(Number), "timed_out"]]);
      expect(lines()).toEqual([expect.stringMatching(/^search\.rate_limit_failed code=timed_out ms=\d+$/)]);
    });

    it("has a classification that matches what an ops event accepts", () => {
      for (const error of [new Error("x"), Object.assign(new Error("y"), { code: "57014" }), "z", null, undefined, 4]) {
        expect(classifyLimiterError(error)).toMatch(/^[A-Za-z0-9_.:]{1,80}$/);
      }
    });
  });

  describe("the hard deadline", () => {
    it("is classified timed_out, told to the app with how long the request had run, and written as one line", async () => {
      const response = await post(route({ deadlineMs: 30 }));

      expect(response.status).toBe(503);
      expect(await answered(response)).toBe("search_unavailable");
      expect(told.deadline).toEqual([[expect.any(Number), "timed_out"]]);
      expect(told.deadline[0]![0]).toBeGreaterThanOrEqual(25);
      expect(lines()).toEqual([expect.stringMatching(/^search\.failed reason=deadline code=timed_out ms=\d+$/)]);
      expect(told.limiter).toEqual([]);
      expect(JSON.stringify([told, lines()])).not.toMatch(/203\.0\.113|private/);
    });
  });

  describe("an error nobody expected", () => {
    it("is classified by the class of what was thrown, or the schema path of an answer that is not SearchV1, and written as one line", async () => {
      const thrower = (error: unknown): SearchService => ({ search: async () => Promise.reject(error), has: async () => true });
      const notAnAnswer: SearchService = { search: async () => ({ v: 1, status: "ok" }) as never, has: async () => true };

      const responses = [
        await post(route({ search: () => thrower(new TypeError(`cannot read ${QUESTION.q}`)) })),
        await post(route({ search: () => notAnAnswer })),
      ];

      for (const response of responses) {
        expect(response.status).toBe(503);
        expect(await answered(response)).toBe("search_unavailable");
      }
      expect(lines().map((l) => l.replace(/ ms=\d+$/, ""))).toEqual([
        "search.failed reason=unexpected code=TypeError",
        expect.stringMatching(/^search\.failed reason=unexpected code=schema:[A-Za-z0-9_.]+$/),
      ]);
      expect(JSON.stringify([told, lines()])).not.toMatch(/203\.0\.113|private|cannot read/);
      expect(told).toEqual({ limiter: [], deadline: [] });
    });

    it("writes no line of its own for a failure the search already told (an ops event and one line of its own), nor for a request that was refused", async () => {
      const searchFailed: SearchService = { search: async () => Promise.reject(new SearchFailure("search_unavailable")), has: async () => true };

      const failed = await post(route({ search: () => searchFailed }));
      const refused = await post(route(), { q: "", lang: "en" });

      expect(failed.status).toBe(503);
      expect(refused.status).toBe(400);
      expect(lines()).toEqual([]);
    });
  });
});
