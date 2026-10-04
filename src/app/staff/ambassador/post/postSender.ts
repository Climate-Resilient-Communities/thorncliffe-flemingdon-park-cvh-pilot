// Delivering an ambassador's post from the open page (S08.02, A-02; epic E08 "Unsent post"). Browser-safe and pure of any page: the form gives it the request
// and the browser's seams (fetch, whether there is signal, the `online` event, a timer, the key maker), so the tests drive it without a browser.
//
// One press of Submit is one request body with one idempotency key. Without signal the post is an unsent post: the page says "Not sent yet. Keep this page
// open; it sends when you have signal" and sends the SAME body with the SAME key when signal returns (the `online` event, and a retry every 20 s in case the
// event never comes). It is held only in this object's memory: nothing is written to the phone's storage (no localStorage, sessionStorage, IndexedDB, Cache
// Storage or cookie; postSender.test.ts asserts it), so closing the page loses it, and the page says so.
//
// The key is kept until the outcome of its press is known (E04's submit rule): a lost answer (no signal, the connection dropped, a server error) keeps it, so
// the next send can never make a second pending version; an answer that says how the press ended (committed, failed, refused) retires it, and the next press
// makes a new one.
//
// A request that has no answer after REQUEST_TIMEOUT_MS (weak signal: the connection opens and then nothing comes) is given up and treated as unsent: the page
// does not stay on "Sending..." for ever, and the same body goes again with the same key, so a press the server did get makes one version all the same.
import type { AmbassadorPostRequest } from "@/contracts/ambassadorPost";
import { SubmitResultSchema } from "@/contracts/alertSubmit";

/** Where the post stands, as the page shows it. */
export type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  /** No signal: held in the page's memory and sent when signal returns. */
  | { kind: "unsent" }
  /** The server has it and is still translating it: asked again shortly with the same key. */
  | { kind: "working" }
  /** `live`: the server committed it and residents already read it on the web, as "Not yet verified" (a D-1 post, S08.03). */
  | { kind: "done"; live?: boolean }
  /** Not sent: `code` is the server's refusal or failure code, or `signed_out`, `not_assigned`, `failed`. */
  | { kind: "error"; code: string };

/** The request without its key: what the form chose. */
export type PostBody = Omit<AmbassadorPostRequest, "key">;

export interface SenderEnv {
  fetch: (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
  /** `navigator.onLine`: false is "no signal for sure"; true may still fail, and a failed request is treated the same. */
  isOnline: () => boolean;
  /** Subscribes to the browser's `online` event; returns the unsubscribe. */
  onOnline: (listener: () => void) => () => void;
  /** `setTimeout`; returns the cancel. */
  later: (run: () => void, ms: number) => () => void;
  /** `crypto.randomUUID()`. */
  newKey: () => string;
  url: string;
}

/** How long to wait before asking again about a submit that is still running, and before retrying an unsent post when no `online` event comes. */
export const WORKING_RETRY_MS = 3_000;
export const UNSENT_RETRY_MS = 20_000;
/** How long one request may go without an answer before it is given up and the post is held as unsent. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Any request the sender delivers: the body of a press and the key of its outcome. S08.04's follow-up requests (correct, withdraw, resolve) are delivered the same way. */
export type KeyedRequest = { key: string };

export interface PostSender<B extends KeyedRequest = AmbassadorPostRequest> {
  /** Sends one press. Ignored while a press is on its way (sending, unsent or working): the page disables the button then. */
  press(body: B extends unknown ? Omit<B, "key"> : never): void;
  state(): SendState;
  /** Stops listening and retrying (the page is going away). */
  stop(): void;
}

export function createPostSender<B extends KeyedRequest = AmbassadorPostRequest>(env: SenderEnv, onChange: (state: SendState) => void): PostSender<B> {
  let current: SendState = { kind: "idle" };
  /** The key of the last press whose outcome is not known yet; null once it is. */
  let openKey: string | null = null;
  /** The entry the open key was made for: a press about another entry never reuses it (one key is one press of one request). */
  let openEntry: string | null = null;
  /** The request on its way; null when none is. */
  let inFlight: B | null = null;
  let cleanups: (() => void)[] = [];

  const set = (next: SendState) => {
    current = next;
    onChange(next);
  };
  const clearWaits = () => {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
  };
  /** The outcome of the press is known: its key is retired and nothing is held any more. */
  const settle = (next: SendState) => {
    openKey = null;
    openEntry = null;
    inFlight = null;
    clearWaits();
    set(next);
  };

  /** No signal, or the request did not get through: hold it and send it again when signal returns. */
  const holdUnsent = () => {
    clearWaits();
    set({ kind: "unsent" });
    const resend = () => void deliver();
    cleanups.push(env.onOnline(resend), env.later(resend, UNSENT_RETRY_MS));
  };

  async function deliver(): Promise<void> {
    const request = inFlight;
    if (request === null) return;
    clearWaits();
    if (!env.isOnline()) return holdUnsent();
    set({ kind: "sending" });
    let response: { status: number; json(): Promise<unknown> };
    const controller = new AbortController();
    let cancelTimeout = () => {};
    try {
      const timedOut = new Promise<never>((_, reject) => {
        cancelTimeout = env.later(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, REQUEST_TIMEOUT_MS);
      });
      response = await Promise.race([
        env.fetch(env.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: controller.signal }),
        timedOut,
      ]);
    } catch {
      // The request did not get through, its answer was lost, or none came in time: the same body and key go again with signal.
      if (inFlight === request) holdUnsent();
      return;
    } finally {
      cancelTimeout();
    }
    if (inFlight !== request) return;
    if (response.status === 401) return settle({ kind: "error", code: "signed_out" });
    if (response.status === 403) return settle({ kind: "error", code: "not_assigned" });
    if (response.status >= 500) {
      // The server may have done it: the key is kept for the next press, which asks with it again.
      inFlight = null;
      return set({ kind: "error", code: "failed" });
    }
    if (response.status !== 200) return settle({ kind: "error", code: "failed" });
    const parsed = SubmitResultSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      inFlight = null;
      return set({ kind: "error", code: "failed" });
    }
    const result = parsed.data;
    if (result.state === "committed") return settle(result.entry_state?.entry.web_published === true ? { kind: "done", live: true } : { kind: "done" });
    if (result.state === "running" || result.outcome === "SUBMIT_IN_PROGRESS") {
      // Still being translated: ask again with the same key, which answers with this press's result once it has one.
      set({ kind: "working" });
      cleanups.push(env.later(() => void deliver(), WORKING_RETRY_MS));
      return;
    }
    return settle({ kind: "error", code: result.outcome ?? "failed" });
  }

  return {
    press(body) {
      if (current.kind === "sending" || current.kind === "unsent" || current.kind === "working") return;
      const entry = (body as { entry_id?: string }).entry_id ?? null;
      if (openKey !== null && entry !== openEntry) openKey = null;
      if (openKey === null) {
        openKey = env.newKey();
        openEntry = entry;
      }
      inFlight = { ...body, key: openKey } as unknown as B;
      void deliver();
    },
    state: () => current,
    stop() {
      clearWaits();
      inFlight = null;
    },
  };
}
