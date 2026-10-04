import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUEST_TIMEOUT_MS, UNSENT_RETRY_MS, WORKING_RETRY_MS, createPostSender, type PostBody, type SendState, type SenderEnv } from "./postSender";

const BODY: PostBody = {
  v: 1,
  into: null,
  alert_id: "01900000-0000-7000-8000-00000000a1e7",
  entry_id: "01900000-0000-7000-8000-00000000e17a",
  rsn: "7001",
  floors: { mode: "all" },
  types: ["elevator"],
  phase: "problem",
  valid: { mode: "resolved" },
  text: "The elevator is out. Use the stairs with care.",
};

const result = (state: "committed" | "running" | "failed" | "refused", outcome: string | null = null) => ({ v: 1, state, outcome, entry_state: null });

/** A browser that the test drives: signal on or off, the `online` event, a clock, and a server that answers what the test says. */
function harness() {
  let online = true;
  const listeners = new Set<() => void>();
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  let clock = 0;
  const answers: (() => Promise<{ status: number; json(): Promise<unknown> }>)[] = [];
  const sent: { url: string; body: unknown }[] = [];
  const signals: AbortSignal[] = [];
  let keys = 0;
  const env: SenderEnv = {
    fetch: vi.fn(async (url: string, init: { body: string; signal: AbortSignal }) => {
      sent.push({ url, body: JSON.parse(init.body) });
      signals.push(init.signal);
      const next = answers.shift();
      if (!next) throw new TypeError("Failed to fetch");
      return next();
    }),
    isOnline: () => online,
    onOnline: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    later: (run, ms) => {
      const timer = { at: clock + ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    newKey: () => `press-key-${String(++keys).padStart(8, "0")}`,
    url: "/api/staff/ambassador/posts",
  };
  const states: SendState[] = [];
  const sender = createPostSender(env, (state) => states.push(state));
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    sender,
    states,
    sent,
    env,
    answer: (status: number, body: unknown) => answers.push(async () => ({ status, json: async () => body })),
    dropConnection: () => answers.push(async () => Promise.reject(new TypeError("Failed to fetch"))),
    /** Weak signal: the request goes out and no answer ever comes. */
    hang: () => answers.push(() => new Promise<never>(() => {})),
    signals,
    setOnline: async (value: boolean) => {
      online = value;
      if (value) for (const listener of [...listeners]) listener();
      await flush();
    },
    advance: async (ms: number) => {
      clock += ms;
      for (const timer of timers.filter((candidate) => !candidate.cancelled && candidate.at <= clock)) {
        timer.cancelled = true;
        timer.run();
      }
      await flush();
    },
    listening: () => listeners.size,
    flush,
  };
}

describe("an ambassador's post, sent from the open page (S08.02)", () => {
  it("sends one press with one key, and is done when the submit committed", async () => {
    const h = harness();
    h.answer(200, result("committed"));
    h.sender.press(BODY);
    await h.flush();
    expect(h.sent).toEqual([{ url: "/api/staff/ambassador/posts", body: { ...BODY, key: "press-key-00000001" } }]);
    expect(h.states.map((state) => state.kind)).toEqual(["sending", "done"]);
  });

  it("holds a post pressed without signal as unsent, in memory, and sends the same body with the same key when signal returns", async () => {
    const h = harness();
    await h.setOnline(false);
    h.sender.press(BODY);
    await h.flush();
    expect(h.sender.state()).toEqual({ kind: "unsent" });
    expect(h.sent).toHaveLength(0);
    expect(h.listening()).toBe(1);
    // Pressing again while it waits changes nothing: the page disables the button, and the sender ignores it too.
    h.sender.press({ ...BODY, text: "Something else." });
    h.answer(200, result("committed"));
    await h.setOnline(true);
    expect(h.sent).toEqual([{ url: "/api/staff/ambassador/posts", body: { ...BODY, key: "press-key-00000001" } }]);
    expect(h.sender.state()).toEqual({ kind: "done" });
    expect(h.listening()).toBe(0);
  });

  it("treats a request that did not get through as unsent, and retries it with the same key, on the online event or after a while", async () => {
    const h = harness();
    h.dropConnection();
    h.sender.press(BODY);
    await h.flush();
    expect(h.sender.state()).toEqual({ kind: "unsent" });
    h.answer(200, result("committed"));
    await h.advance(UNSENT_RETRY_MS);
    expect(h.sent.map((request) => (request.body as { key: string }).key)).toEqual(["press-key-00000001", "press-key-00000001"]);
    expect(h.sender.state()).toEqual({ kind: "done" });
  });

  it("gives up a request with no answer after 20 s, holds the post as unsent, and sends it again with the same key", async () => {
    const h = harness();
    h.hang();
    h.sender.press(BODY);
    await h.flush();
    expect(h.sender.state()).toEqual({ kind: "sending" });
    await h.advance(REQUEST_TIMEOUT_MS - 1);
    expect(h.sender.state()).toEqual({ kind: "sending" });
    await h.advance(1);
    expect(h.sender.state()).toEqual({ kind: "unsent" });
    expect(h.signals[0].aborted).toBe(true);
    h.answer(200, result("committed"));
    await h.advance(UNSENT_RETRY_MS);
    expect(h.sent.map((request) => (request.body as { key: string }).key)).toEqual(["press-key-00000001", "press-key-00000001"]);
    expect(h.sender.state()).toEqual({ kind: "done" });
    expect(h.signals[1].aborted).toBe(false);
  });

  it("asks again with the same key while the server is still translating, until the press has an outcome", async () => {
    const h = harness();
    h.answer(200, result("running"));
    h.sender.press(BODY);
    await h.flush();
    expect(h.sender.state()).toEqual({ kind: "working" });
    h.answer(200, result("refused", "SUBMIT_IN_PROGRESS"));
    await h.advance(WORKING_RETRY_MS);
    expect(h.sender.state()).toEqual({ kind: "working" });
    h.answer(200, result("committed"));
    await h.advance(WORKING_RETRY_MS);
    expect(new Set(h.sent.map((request) => (request.body as { key: string }).key))).toEqual(new Set(["press-key-00000001"]));
    expect(h.sender.state()).toEqual({ kind: "done" });
  });

  it("retires the key once a press is known to have failed, so the next press makes a new one", async () => {
    const h = harness();
    h.answer(200, result("failed", "SMS_BODY_TOO_LONG"));
    h.sender.press(BODY);
    await h.flush();
    expect(h.sender.state()).toEqual({ kind: "error", code: "SMS_BODY_TOO_LONG" });
    h.answer(200, result("committed"));
    h.sender.press({ ...BODY, text: "Shorter." });
    await h.flush();
    expect(h.sent.map((request) => (request.body as { key: string }).key)).toEqual(["press-key-00000001", "press-key-00000002"]);
  });

  it("keeps the key after a server error, whose outcome is not known, so the next press cannot make a second version", async () => {
    const h = harness();
    h.answer(502, {});
    h.sender.press(BODY);
    await h.flush();
    expect(h.sender.state()).toEqual({ kind: "error", code: "failed" });
    h.answer(200, result("committed"));
    h.sender.press(BODY);
    await h.flush();
    expect(h.sent.map((request) => (request.body as { key: string }).key)).toEqual(["press-key-00000001", "press-key-00000001"]);
  });

  it("says a signed-out person, or one no longer assigned to the building, was not sent, and holds nothing", async () => {
    const h = harness();
    h.answer(401, { error: "unauthenticated" });
    h.sender.press(BODY);
    await h.flush();
    expect(h.sender.state()).toEqual({ kind: "error", code: "signed_out" });
    h.answer(403, { error: "forbidden" });
    h.sender.press(BODY);
    await h.flush();
    expect(h.sender.state()).toEqual({ kind: "error", code: "not_assigned" });
  });
});

describe("nothing of a post is written to the phone's storage (S08.02, unsent post)", () => {
  const touched: string[] = [];
  const watch = (name: string) => {
    const handler: ProxyHandler<object> = {
      get: (_target, property) => {
        touched.push(`${name}.${String(property)}`);
        return () => undefined;
      },
    };
    return new Proxy({}, handler);
  };
  const saved: Record<string, PropertyDescriptor | undefined> = {};
  const APIS = ["localStorage", "sessionStorage", "indexedDB", "caches"] as const;

  beforeEach(() => {
    touched.length = 0;
    for (const api of APIS) {
      saved[api] = Object.getOwnPropertyDescriptor(globalThis, api);
      Object.defineProperty(globalThis, api, { configurable: true, get: () => (touched.push(api), watch(api)) });
    }
    saved.document = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { configurable: true, get: () => (touched.push("document"), watch("document")) });
  });
  afterEach(() => {
    for (const name of [...APIS, "document"]) {
      const descriptor = saved[name];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  });

  it("uses no storage API while a post is pressed offline, held, retried and delivered", async () => {
    const h = harness();
    await h.setOnline(false);
    h.sender.press(BODY);
    await h.flush();
    h.dropConnection();
    await h.setOnline(true);
    h.answer(200, result("committed"));
    await h.advance(UNSENT_RETRY_MS);
    expect(h.sender.state()).toEqual({ kind: "done" });
    expect(touched).toEqual([]);
  });

  it("is written so: neither the sender nor the form names a storage API", () => {
    for (const file of ["postSender.ts", "PostForm.tsx"]) {
      // The code, without its comments (which say what is never used).
      const source = readFileSync(path.join(__dirname, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|document\.cookie|serviceWorker/);
    }
  });
});
