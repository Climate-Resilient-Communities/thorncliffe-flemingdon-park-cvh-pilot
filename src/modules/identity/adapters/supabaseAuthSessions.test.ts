// The Supabase Auth session adapter against a fake fetch: what it asks Supabase, which cookies it
// writes and when. No test reaches a real Supabase project.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CookieJar } from "../application/ports";
import { SESSION_COOKIE, sessionKeyOf, supabaseAuthSessions, tokenLifetimeOf } from "./supabaseAuthSessions";

const URL_BASE = "https://example-project.supabase.co";
const PUBLISHABLE = "sb_publishable_test_only";
const USER_ID = "4f8a3a3e-5b7c-4d2e-9f10-1a2b3c4d5e6f";
const SESSION_ID = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
/** An access token shaped like Supabase's (its signature is never checked here: Supabase checks it). */
const jwt = (claims: Record<string, unknown>) =>
  [Buffer.from('{"alg":"ES256","typ":"JWT"}').toString("base64url"), Buffer.from(JSON.stringify(claims)).toString("base64url"), "signature"].join(".");
const ACCESS = jwt({ sub: USER_ID, session_id: SESSION_ID, iat: 1_790_000_000, exp: 1_790_000_000 + 43_200, aal: "aal1" });
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

interface Call {
  url: string;
  method: string;
  headers: Headers;
}

function fakeFetch(respond: (call: Call) => { status: number; body: unknown } | "network") {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers) };
    calls.push(call);
    const answer = respond(call);
    if (answer === "network") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function memoryJar(initial: Record<string, string> = {}) {
  const cookies = new Map(Object.entries(initial));
  const writes: Parameters<CookieJar["setAll"]>[0] = [];
  const jar: CookieJar = {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: (list) => {
      writes.push(...list);
      for (const { name, value, options } of list) {
        if (options.maxAge === 0 || value === "") cookies.delete(name);
        else cookies.set(name, value);
      }
    },
  };
  return { jar, cookies, writes };
}

const user = (factors: unknown[] = []) => ({ id: USER_ID, aud: "authenticated", role: "authenticated", email: "jdoe@staff.cvh.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z", factors });
const session = () => ({
  access_token: ACCESS,
  refresh_token: "refresh-token-for-tests",
  token_type: "bearer",
  expires_in: 43_200,
  expires_at: Math.floor(Date.now() / 1000) + 43_200,
  user: user(),
});

const config = (fetch: typeof globalThis.fetch) => ({ url: URL_BASE, publishableKey: PUBLISHABLE, secureCookies: true, fetch });

describe("Supabase Auth sessions", () => {
  it("checks the password and holds the session back until the sign-in is accepted", async () => {
    const { fetch, calls } = fakeFetch((call) => (call.url.includes("/token") ? { status: 200, body: session() } : { status: 200, body: user() }));
    const { jar, cookies, writes } = memoryJar();

    const check = await supabaseAuthSessions(config(fetch), jar).checkPassword({ login: "jdoe@staff.cvh.invalid", password: "rvh-jane-doe" });

    expect(check).toMatchObject({ ok: true, authUserId: USER_ID, sessionKey: sha256(SESSION_ID), tokenLifetimeSeconds: 43_200 });
    expect(calls[0]).toMatchObject({ url: `${URL_BASE}/auth/v1/token?grant_type=password`, method: "POST" });
    expect(cookies.size).toBe(0);
    if (!check.ok) throw new Error("expected a session");
    await check.accept();
    expect([...cookies.keys()]).toEqual([SESSION_COOKIE]);
    expect(writes.at(-1)?.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 43_200 });

    // The next request reads the cookie and asks Supabase who it is, with that access token only.
    const next = await supabaseAuthSessions(config(fetch), jar).currentUser();
    expect(next).toEqual({ authUserId: USER_ID, authenticatorEnrolled: false, sessionKey: sha256(SESSION_ID) });
    expect(calls.at(-1)).toMatchObject({ url: `${URL_BASE}/auth/v1/user`, method: "GET" });
    expect(calls.at(-1)?.headers.get("authorization")).toBe(`Bearer ${ACCESS}`);
  });

  it("ends a refused sign-in's session at Supabase and writes no cookie", async () => {
    const { fetch, calls } = fakeFetch((call) => (call.url.includes("/token") ? { status: 200, body: session() } : { status: 204, body: {} }));
    const { jar, writes } = memoryJar();

    const check = await supabaseAuthSessions(config(fetch), jar).checkPassword({ login: "jdoe@staff.cvh.invalid", password: "rvh-jane-doe" });
    if (!check.ok) throw new Error("expected a session");
    await check.discard();

    expect(writes).toEqual([]);
    expect(calls.at(-1)).toMatchObject({ url: `${URL_BASE}/auth/v1/logout?scope=local`, method: "POST" });
    expect(calls.at(-1)?.headers.get("authorization")).toBe(`Bearer ${ACCESS}`);
  });

  it.each([
    [{ status: 400, body: { error_code: "invalid_credentials", msg: "Invalid login credentials" } }, "invalid_credentials"],
    [{ status: 429, body: { error_code: "over_request_rate_limit", msg: "Too many requests" } }, "unavailable"],
    [{ status: 500, body: { msg: "boom" } }, "unavailable"],
    ["network" as const, "unavailable"],
  ])("reads a failed check %j as %s", async (answer, error) => {
    const { fetch } = fakeFetch(() => answer);

    expect(await supabaseAuthSessions(config(fetch), memoryJar().jar).checkPassword({ login: "x@staff.cvh.invalid", password: "wrong" })).toEqual({ ok: false, error });
  });

  it("has no session without the cookie, and asks nothing", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: user() }));

    expect(await supabaseAuthSessions(config(fetch), memoryJar().jar).currentUser()).toBeNull();
    expect(await supabaseAuthSessions(config(fetch), memoryJar({ [SESSION_COOKIE]: "not a session" }).jar).currentUser()).toBeNull();
    expect(calls).toEqual([]);
  });

  async function signedInJar() {
    const { fetch } = fakeFetch(() => ({ status: 200, body: session() }));
    const memory = memoryJar();
    const check = await supabaseAuthSessions(config(fetch), memory.jar).checkPassword({ login: "jdoe@staff.cvh.invalid", password: "rvh-jane-doe" });
    if (!check.ok) throw new Error("expected a session");
    await check.accept();
    return memory;
  }

  it("treats a token Supabase refuses (expired, signed out, user deleted) as no session, and a Supabase failure as an error", async () => {
    const { jar } = await signedInJar();
    const refused = fakeFetch(() => ({ status: 403, body: { error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" } }));
    expect(await supabaseAuthSessions(config(refused.fetch), jar).currentUser()).toBeNull();

    const failing = fakeFetch(() => ({ status: 500, body: { msg: "boom" } }));
    await expect(supabaseAuthSessions(config(failing.fetch), jar).currentUser()).rejects.toThrow(/could not check the session/);
  });

  it("reports a verified authenticator", async () => {
    const { jar } = await signedInJar();
    const { fetch } = fakeFetch(() => ({ status: 200, body: user([{ id: "f1", factor_type: "totp", status: "verified", created_at: "", updated_at: "" }]) }));

    expect(await supabaseAuthSessions(config(fetch), jar).currentUser()).toEqual({ authUserId: USER_ID, authenticatorEnrolled: true, sessionKey: sha256(SESSION_ID) });
  });

  it("signs out at Supabase and clears the cookie, even when Supabase fails", async () => {
    const { jar, cookies } = await signedInJar();
    const { fetch, calls } = fakeFetch(() => "network");

    await supabaseAuthSessions(config(fetch), jar).signOut();

    expect(calls.at(-1)).toMatchObject({ url: `${URL_BASE}/auth/v1/logout?scope=local`, method: "POST" });
    expect(cookies.size).toBe(0);
  });

  it("keys a session by the SHA-256 of its session_id claim, the same for every token of the session, and a token without one by the token itself", () => {
    const refreshed = jwt({ sub: USER_ID, session_id: SESSION_ID, iat: 1_790_000_600, exp: 1_790_043_800 });
    expect(sessionKeyOf(ACCESS)).toBe(sha256(SESSION_ID));
    expect(sessionKeyOf(refreshed)).toBe(sha256(SESSION_ID));

    const noSessionId = jwt({ sub: USER_ID, iat: 1, exp: 2 });
    expect(sessionKeyOf(noSessionId)).toBe(sha256(`access-token:${noSessionId}`));
    expect(sessionKeyOf("not-a-jwt")).toBe(sha256("access-token:not-a-jwt"));
    expect(sessionKeyOf(noSessionId)).not.toBe(sessionKeyOf(jwt({ sub: USER_ID, iat: 1, exp: 3 })));
  });

  it("reads the access token's lifetime as exp - iat, or null when the token does not carry both", () => {
    expect(tokenLifetimeOf(ACCESS)).toBe(43_200);
    expect(tokenLifetimeOf(jwt({ iat: 100, exp: 3_700 }))).toBe(3_600);
    expect(tokenLifetimeOf(jwt({ exp: 3_700 }))).toBeNull();
    expect(tokenLifetimeOf("not-a-jwt")).toBeNull();
  });
});
