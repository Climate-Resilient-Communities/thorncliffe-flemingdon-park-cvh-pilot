import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MARK_ROUTE, ROUND_ROUTE, type RoundResponse } from "@/contracts/checkinRound";
import { BACKGROUND_LIMIT_MS, UNSENT_RETRY_MS, createRoundModel, type RoundEnv, type RoundState } from "./roundModel";

const REF_A = "3b0b8f9e-6a51-4c1e-9d2a-0b6f1c2d3e4f";
const REF_B = "4c1c9fa0-7b62-4d2f-8e3b-1c7f2d3e4f50";
const ROUND: RoundResponse = {
  rounds: [
    {
      headline: "Extreme heat in Thorncliffe Park. Cooling centres are open.",
      buildings: [
        {
          address: "4 Milepost Pl",
          floors: [
            {
              kind: "contacts",
              label: "3",
              requests: [
                { round_ref: REF_A, phone: "+14165550181", method: "call", status: "pending" },
                { round_ref: REF_B, phone: "+14165550182", method: "text", status: "pending" },
              ],
            },
            { kind: "counts", label: "4", counts: { pending: 2, done: 0, not_reached: 0, needs_help: 0 } },
          ],
        },
      ],
    },
  ],
};

type Answer = { status: number; body?: unknown } | "no_answer";
/** What a captive portal or a proxy answers: a page, not JSON (the harness's `json()` then throws, as the browser's does). */
const HTML_PAGE = Symbol("html");

/** The browser, played by the test: signal, the clock, the timers it never runs by itself, and the server's answers, one request at a time. */
function harness(options: { online?: boolean } = {}) {
  let online = options.online ?? true;
  let clock = Date.UTC(2026, 9, 6, 14, 0);
  let ids = 0;
  const listeners = new Set<() => void>();
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const requests: { url: string; body: Record<string, unknown>; answer: (answer: Answer) => void }[] = [];
  const states: RoundState[] = [];
  const env: RoundEnv = {
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        requests.push({
          url,
          body: JSON.parse(init.body) as Record<string, unknown>,
          answer: (answer) => (answer === "no_answer" ? reject(new Error("network")) : resolve({
                  status: answer.status,
                  json: async () => {
                    if (answer.body === HTML_PAGE) throw new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON");
                    return answer.body ?? null;
                  },
                })),
        });
      }),
    isOnline: () => online,
    onOnline: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    later: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    newId: () => `0f0e0d0c-0b0a-4908-8706-${String((ids += 1)).padStart(12, "0")}`,
    now: () => clock,
  };
  const model = createRoundModel(env, (state) => states.push(state));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    model,
    requests,
    timers,
    state: () => model.state(),
    /** Answers the oldest request not yet answered, then lets the model go on. */
    async answer(answer: Answer) {
      const request = requests.find((candidate) => !(candidate as { done?: boolean }).done);
      if (!request) throw new Error("no request waits for an answer");
      (request as { done?: boolean }).done = true;
      request.answer(answer);
      await settle();
      await settle();
    },
    pending: () => requests.filter((request) => !(request as { done?: boolean }).done),
    async signal(next: boolean) {
      online = next;
      model.signal(next);
      if (next) for (const listener of [...listeners]) listener();
      await settle();
    },
    advance(ms: number) {
      clock += ms;
    },
    settle,
  };
}

async function loaded(options?: { online?: boolean }) {
  const h = harness(options);
  h.model.load();
  await h.settle();
  await h.answer({ status: 200, body: ROUND });
  return h;
}

const statusOf = (state: RoundState, roundRef: string) =>
  state.round?.rounds[0]?.buildings[0]?.floors.flatMap((floor) => (floor.kind === "contacts" ? floor.requests : [])).find((request) => request.round_ref === roundRef)?.status;

describe("loading the round", () => {
  it("reads it with a POST and holds it in memory only", async () => {
    const h = await loaded();
    expect(h.requests[0]).toMatchObject({ url: ROUND_ROUTE, body: { v: 1 } });
    expect(h.state()).toMatchObject({ phase: "ready", round: ROUND, waiting: [], online: true, notes: {} });
  });

  it("says 'Reload your round with signal' when opened without signal, and asks nothing", async () => {
    const h = harness({ online: false });
    h.model.load();
    await h.settle();
    expect(h.requests).toEqual([]);
    expect(h.state()).toMatchObject({ phase: "cleared", round: null });
  });

  it("stops on a 401 (signed out) and says a round that cannot be read could not be loaded", async () => {
    const signedOut = harness();
    signedOut.model.load();
    await signedOut.settle();
    await signedOut.answer({ status: 401, body: { error: "unauthenticated" } });
    expect(signedOut.state().phase).toBe("signed_out");
    const failed = harness();
    failed.model.load();
    await failed.settle();
    await failed.answer({ status: 500 });
    expect(failed.state().phase).toBe("failed");
  });
});

describe("one tap with signal", () => {
  it("sends the mark at once with its id, and the row shows it", async () => {
    const h = await loaded();
    h.model.mark(REF_A, "done");
    expect(statusOf(h.state(), REF_A)).toBe("done");
    expect(h.pending()).toHaveLength(1);
    expect(h.pending()[0]).toMatchObject({ url: MARK_ROUTE, body: { v: 1, mark_id: "0f0e0d0c-0b0a-4908-8706-000000000001", round_ref: REF_A, status: "done" } });
    expect(h.state().waiting).toHaveLength(1);
    await h.answer({ status: 200, body: { outcome: "marked" } });
    expect(h.state().waiting).toEqual([]);
    expect(statusOf(h.state(), REF_A)).toBe("done");
  });

  it("sends a mark again with the same id when its answer is lost, or the server failed", async () => {
    const h = await loaded();
    h.model.mark(REF_A, "needs_help");
    await h.answer("no_answer");
    expect(h.state().waiting).toHaveLength(1);
    // No `online` event comes: the retry timer sends it again, with the same id.
    h.timers.filter((timer) => timer.ms === UNSENT_RETRY_MS && !timer.cancelled).at(-1)!.run();
    await h.settle();
    await h.answer({ status: 503 });
    h.timers.filter((timer) => timer.ms === UNSENT_RETRY_MS && !timer.cancelled).at(-1)!.run();
    await h.settle();
    await h.answer({ status: 200, body: { outcome: "already" } });
    const marks = h.requests.filter((request) => request.url === MARK_ROUTE).map((request) => request.body.mark_id);
    expect(marks).toEqual(["0f0e0d0c-0b0a-4908-8706-000000000001", "0f0e0d0c-0b0a-4908-8706-000000000001", "0f0e0d0c-0b0a-4908-8706-000000000001"]);
    expect(h.state().waiting).toEqual([]);
  });

  it("keeps a mark waiting, with its id, on an answer that is not the server's word: a captive portal's page, a 404, a 4xx in another body", async () => {
    const h = await loaded();
    const retry = async () => {
      h.timers.filter((timer) => timer.ms === UNSENT_RETRY_MS && !timer.cancelled).at(-1)!.run();
      await h.settle();
    };
    h.model.mark(REF_A, "needs_help");
    // A Wi-Fi sign-in page answers 200 with its HTML: not the mark's answer.
    await h.answer({ status: 200, body: HTML_PAGE });
    expect(h.state().waiting).toHaveLength(1);
    expect(h.state().notes).toEqual({});
    expect(statusOf(h.state(), REF_A)).toBe("needs_help");
    await retry();
    await h.answer({ status: 404, body: HTML_PAGE });
    expect(h.state().waiting).toHaveLength(1);
    await retry();
    await h.answer({ status: 400, body: { message: "Bad gateway request" } });
    expect(h.state().waiting).toHaveLength(1);
    await retry();
    await h.answer({ status: 200, body: { outcome: "marked" } });
    expect(h.state().waiting).toEqual([]);
    expect(h.state().notes).toEqual({});
    const marks = h.requests.filter((request) => request.url === MARK_ROUTE).map((request) => request.body.mark_id);
    expect(new Set(marks)).toEqual(new Set(["0f0e0d0c-0b0a-4908-8706-000000000001"]));
    expect(marks).toHaveLength(4);
  });

  it("drops a mark the server refused in its own error body, and says it could not be saved", async () => {
    const h = await loaded();
    h.model.mark(REF_A, "done");
    await h.answer({ status: 400, body: { error: "bad_request" } });
    expect(h.state().waiting).toEqual([]);
    expect(h.state().notes).toEqual({ [REF_A]: "mark_failed" });
  });

  it("says what a late mark was answered, and that the round has ended when a mark is refused", async () => {
    const h = await loaded();
    h.model.mark(REF_A, "not_reached");
    await h.answer({ status: 200, body: { outcome: "hub_told" } });
    h.model.mark(REF_B, "done");
    await h.answer({ status: 200, body: { outcome: "request_ended" } });
    expect(h.state().notes).toEqual({ [REF_A]: "hub_told", [REF_B]: "request_ended" });
    h.model.mark(REF_B, "needs_help");
    expect(h.state().notes).toEqual({ [REF_A]: "hub_told" });
    await h.answer({ status: 403, body: { error: "forbidden" } });
    expect(h.state().notes).toEqual({ [REF_A]: "hub_told", [REF_B]: "round_ended" });
  });

  it("stops sending when the session has ended, and keeps the marks waiting", async () => {
    const h = await loaded();
    h.model.mark(REF_A, "done");
    h.model.mark(REF_B, "done");
    await h.answer({ status: 401, body: { error: "unauthenticated" } });
    expect(h.state()).toMatchObject({ phase: "signed_out" });
    expect(h.state().waiting).toHaveLength(2);
    expect(h.pending()).toEqual([]);
  });
});

describe("marks made without signal", () => {
  it("wait in the page, are counted, and are sent in order with their ids, one at a time, when signal returns", async () => {
    const h = await loaded();
    await h.signal(false);
    h.model.mark(REF_A, "done");
    h.model.mark(REF_B, "not_reached");
    h.model.mark(REF_A, "needs_help");
    expect(h.pending()).toEqual([]);
    expect(h.state()).toMatchObject({ online: false });
    expect(h.state().waiting.map((mark) => [mark.roundRef, mark.status])).toEqual([[REF_A, "done"], [REF_B, "not_reached"], [REF_A, "needs_help"]]);
    // The rows show the latest mark made on each.
    expect(statusOf(h.state(), REF_A)).toBe("needs_help");
    expect(statusOf(h.state(), REF_B)).toBe("not_reached");

    await h.signal(true);
    // One at a time: the next goes only once the one before is answered.
    expect(h.pending().map((request) => request.body.status)).toEqual(["done"]);
    await h.answer({ status: 200, body: { outcome: "marked" } });
    expect(h.pending().map((request) => request.body.status)).toEqual(["not_reached"]);
    await h.answer({ status: 200, body: { outcome: "marked" } });
    expect(h.pending().map((request) => request.body.status)).toEqual(["needs_help"]);
    await h.answer({ status: 200, body: { outcome: "marked" } });
    expect(h.requests.filter((request) => request.url === MARK_ROUTE).map((request) => request.body.mark_id)).toEqual([
      "0f0e0d0c-0b0a-4908-8706-000000000001",
      "0f0e0d0c-0b0a-4908-8706-000000000002",
      "0f0e0d0c-0b0a-4908-8706-000000000003",
    ]);
    expect(h.state().waiting).toEqual([]);
    expect(statusOf(h.state(), REF_A)).toBe("needs_help");
  });
});

describe("the page in the background (never a timer: the time hidden is compared with now)", () => {
  it("keeps everything after 9 minutes, and clears the round and every unsent mark after 10, with no timer run in between (a clock jump)", async () => {
    const h = await loaded();
    await h.signal(false);
    h.model.mark(REF_A, "done");
    h.model.hidden();
    h.advance(9 * 60 * 1000);
    h.model.visible();
    expect(h.state()).toMatchObject({ phase: "ready", round: expect.anything() });
    expect(h.state().waiting).toHaveLength(1);

    h.model.hidden();
    h.advance(BACKGROUND_LIMIT_MS);
    h.model.visible();
    expect(h.state()).toMatchObject({ phase: "cleared", round: null, waiting: [], notes: {} });
    // Nothing waits any more: signal coming back sends nothing.
    await h.signal(true);
    expect(h.pending()).toEqual([]);
    // The page never set a timer for the background limit.
    expect(h.timers.some((timer) => timer.ms >= BACKGROUND_LIMIT_MS)).toBe(false);
  });

  it("clears the round's numbers on pagehide, keeps the unsent marks, and on a restore within 10 minutes reads the round again and sends them", async () => {
    const h = await loaded();
    await h.signal(false);
    h.model.mark(REF_B, "needs_help");
    h.model.pagehide();
    expect(h.state()).toMatchObject({ phase: "cleared", round: null });
    expect(h.state().waiting).toHaveLength(1);
    h.advance(3 * 60 * 1000);
    await h.signal(true);
    h.model.pageshow(true);
    await h.settle();
    const urls = h.pending().map((request) => request.url);
    expect(urls).toContain(ROUND_ROUTE);
    expect(urls).toContain(MARK_ROUTE);
  });

  it("clears everything on a restore from the page cache after 10 minutes or more, and ignores an answer to a request made before", async () => {
    const h = await loaded();
    h.model.mark(REF_A, "done");
    expect(h.pending()).toHaveLength(1);
    h.model.pagehide();
    h.advance(BACKGROUND_LIMIT_MS + 1);
    h.model.pageshow(true);
    expect(h.state()).toMatchObject({ phase: "cleared", round: null, waiting: [] });
    await h.answer({ status: 200, body: { outcome: "marked" } });
    expect(h.state()).toMatchObject({ phase: "cleared", round: null, waiting: [], notes: {} });
  });

  it("on a real restore from the page cache (visibilitychange visible, then pageshow): back at 9 minutes the round is read again and the marks go on", async () => {
    const h = await loaded();
    h.model.mark(REF_A, "done");
    // Leaving, in the browser's order: pagehide, then hidden. The mark's request gets no answer before the page is frozen.
    h.model.pagehide();
    h.model.hidden();
    h.advance(9 * 60 * 1000);
    h.model.visible();
    h.model.pageshow(true);
    await h.settle();
    expect(h.state().waiting).toHaveLength(1);
    // After the request made before the page left: the mark again, with its id, and the round.
    const after = h.pending().slice(1);
    expect(after.map((request) => request.url).sort()).toEqual([MARK_ROUTE, ROUND_ROUTE].sort());
    expect(after.find((request) => request.url === MARK_ROUTE)!.body.mark_id).toBe(h.requests[1]!.body.mark_id);
  });

  it("on a real restore from the page cache (visibilitychange visible, then pageshow) at 10 minutes: cleared, nothing read again until the person reloads", async () => {
    const h = await loaded();
    h.model.mark(REF_A, "done");
    h.model.pagehide();
    h.model.hidden();
    h.advance(BACKGROUND_LIMIT_MS);
    const asked = h.requests.length;
    h.model.visible();
    h.model.pageshow(true);
    await h.settle();
    expect(h.state()).toMatchObject({ phase: "cleared", round: null, waiting: [], notes: {} });
    expect(h.requests, "neither the round nor the cleared mark is asked for again").toHaveLength(asked);
    // The answer to the mark sent before the page left changes nothing, and signal coming back sends nothing.
    await h.answer({ status: 200, body: { outcome: "marked" } });
    await h.signal(true);
    expect(h.state()).toMatchObject({ phase: "cleared", round: null, waiting: [] });
    expect(h.requests).toHaveLength(asked);
    // A later restore within 10 minutes keeps it cleared: only "Reload my round" reads it again.
    h.model.pagehide();
    h.model.hidden();
    h.advance(60_000);
    h.model.visible();
    h.model.pageshow(true);
    await h.settle();
    expect(h.state().phase).toBe("cleared");
    expect(h.requests).toHaveLength(asked);
    h.model.load();
    await h.settle();
    await h.answer({ status: 200, body: ROUND });
    expect(h.state()).toMatchObject({ phase: "ready", round: ROUND });
  });

  it("keeps the answer to a waiting mark refused while nothing of the round is shown (restored without signal), so the page can say it", async () => {
    const h = await loaded();
    await h.signal(false);
    h.model.mark(REF_B, "needs_help");
    h.model.pagehide();
    h.model.hidden();
    h.advance(5 * 60 * 1000);
    h.model.visible();
    h.model.pageshow(true);
    await h.settle();
    expect(h.state()).toMatchObject({ phase: "cleared", round: null });
    expect(h.state().waiting).toHaveLength(1);
    await h.signal(true);
    expect(h.pending().map((request) => request.url)).toEqual([MARK_ROUTE]);
    await h.answer({ status: 403, body: { error: "forbidden" } });
    expect(h.state()).toMatchObject({ phase: "cleared", round: null, waiting: [], notes: { [REF_B]: "round_ended" } });
  });

  it("does nothing on a pageshow that is not a restore", async () => {
    const h = await loaded();
    h.model.pageshow(false);
    expect(h.state()).toMatchObject({ phase: "ready", round: ROUND });
  });

  it("reloads the round with signal after it was cleared", async () => {
    const h = await loaded();
    h.model.hidden();
    h.advance(BACKGROUND_LIMIT_MS);
    h.model.visible();
    h.model.load();
    await h.settle();
    await h.answer({ status: 200, body: ROUND });
    expect(h.state()).toMatchObject({ phase: "ready", round: ROUND });
  });
});

describe("a tap that cannot be a mark", () => {
  it("is ignored before the round is held, or for a row the round does not have", async () => {
    const h = harness();
    h.model.mark(REF_A, "done");
    expect(h.state().waiting).toEqual([]);
    const ready = await loaded();
    ready.model.mark("5d2d0ab1-8c73-4e30-9f4c-2d8a3e4f5061", "done");
    expect(ready.state().waiting).toEqual([]);
  });
});

describe("nothing of the round is written to the phone's storage (AD-1)", () => {
  const touched: string[] = [];
  const watch = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, property) => {
          touched.push(`${name}.${String(property)}`);
          return () => undefined;
        },
      },
    );
  const APIS = ["localStorage", "sessionStorage", "indexedDB", "caches", "document"] as const;
  const saved: Record<string, PropertyDescriptor | undefined> = {};

  beforeEach(() => {
    touched.length = 0;
    for (const api of APIS) {
      saved[api] = Object.getOwnPropertyDescriptor(globalThis, api);
      Object.defineProperty(globalThis, api, { configurable: true, get: () => (touched.push(api), watch(api)) });
    }
  });
  afterEach(() => {
    for (const api of APIS) {
      const descriptor = saved[api];
      if (descriptor) Object.defineProperty(globalThis, api, descriptor);
      else delete (globalThis as Record<string, unknown>)[api];
    }
  });

  it("uses no storage API while the round is loaded, marked without signal, sent, sent to the background and cleared", async () => {
    const h = await loaded();
    await h.signal(false);
    h.model.mark(REF_A, "needs_help");
    h.model.hidden();
    h.advance(60_000);
    h.model.visible();
    await h.signal(true);
    await h.answer({ status: 200, body: { outcome: "marked" } });
    h.model.pagehide();
    h.advance(BACKGROUND_LIMIT_MS);
    h.model.pageshow(true);
    expect(touched).toEqual([]);
  });

  it("is written so: neither the model nor the page names a storage API", () => {
    for (const file of ["roundModel.ts", "RoundPage.tsx"]) {
      // The code, without its comments (which say what is never used).
      const source = readFileSync(path.join(__dirname, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|document\.cookie|serviceWorker/);
    }
  });
});
