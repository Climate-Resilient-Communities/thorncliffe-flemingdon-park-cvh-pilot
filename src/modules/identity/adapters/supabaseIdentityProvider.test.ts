// The Supabase Auth adapter against a fake fetch: the requests it makes and how it reads the
// answers. No test reaches a real Supabase project.
import { describe, expect, it } from "vitest";
import { supabaseIdentityProvider } from "./supabaseIdentityProvider";

const URL_BASE = "https://example-project.supabase.co";
const SECRET = "sb_secret_test_only_not_a_real_key";
const USER_ID = "4f8a3a3e-5b7c-4d2e-9f10-1a2b3c4d5e6f";

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
}

function fakeFetch(respond: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    const { status, body } = respond(call);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("Supabase Auth identity provider", () => {
  it("creates a confirmed user with the login and password, so Supabase sends no email", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: { id: USER_ID, email: "jdoe@staff.cvh.invalid" } }));
    const idp = supabaseIdentityProvider({ url: URL_BASE, secretKey: SECRET, fetch });

    expect(await idp.createLogin({ login: "jdoe@staff.cvh.invalid", password: "rvh-jane-doe" })).toEqual({ ok: true, authUserId: USER_ID });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: `${URL_BASE}/auth/v1/admin/users`,
      method: "POST",
      body: { email: "jdoe@staff.cvh.invalid", password: "rvh-jane-doe", email_confirm: true, app_metadata: { cvh_staff: true } },
    });
    expect(calls[0].headers.get("apikey")).toBe(SECRET);
  });

  it.each([
    [422, { error_code: "email_exists", msg: "A user with this email address has already been registered" }, "login_taken"],
    [422, { error_code: "weak_password", msg: "Password should contain digits", weak_password: { reasons: ["characters"] } }, "rejected"],
    [400, { error_code: "validation_failed", msg: "Unable to validate email address: invalid format" }, "rejected"],
    [401, { error_code: "not_admin", msg: "User not allowed" }, "unavailable"],
    [503, { msg: "Service unavailable" }, "unavailable"],
  ])("reads a %i answer as %j", async (status, body, expected) => {
    const { fetch } = fakeFetch(() => ({ status, body }));
    const idp = supabaseIdentityProvider({ url: URL_BASE, secretKey: SECRET, fetch });

    expect(await idp.createLogin({ login: "jdoe@staff.cvh.invalid", password: "rvh-jane-doe" })).toEqual({ ok: false, error: expected });
  });

  it("treats a network failure as unavailable", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const idp = supabaseIdentityProvider({ url: URL_BASE, secretKey: SECRET, fetch });

    expect(await idp.createLogin({ login: "jdoe@staff.cvh.invalid", password: "rvh-jane-doe" })).toEqual({ ok: false, error: "unavailable" });
  });

  it("deletes a user, and throws when Supabase refuses", async () => {
    const ok = fakeFetch(() => ({ status: 200, body: {} }));
    await supabaseIdentityProvider({ url: URL_BASE, secretKey: SECRET, fetch: ok.fetch }).deleteLogin(USER_ID);
    expect(ok.calls[0]).toMatchObject({ url: `${URL_BASE}/auth/v1/admin/users/${USER_ID}`, method: "DELETE" });

    const refused = fakeFetch(() => ({ status: 404, body: { error_code: "user_not_found", msg: "User not found" } }));
    await expect(supabaseIdentityProvider({ url: URL_BASE, secretKey: SECRET, fetch: refused.fetch }).deleteLogin(USER_ID)).rejects.toThrow(
      /refused to delete a user \(status 404, code user_not_found\)/,
    );
  });

  it("finds a login among the users, with its staff marker and creation time", async () => {
    const users = [
      { id: "u1", email: "other@staff.cvh.invalid", created_at: "2026-01-01T00:00:00Z", app_metadata: {} },
      { id: USER_ID, email: "jdoe@staff.cvh.invalid", created_at: "2026-01-02T00:00:00Z", app_metadata: { cvh_staff: true } },
    ];
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: { users, aud: "authenticated" } }));
    const idp = supabaseIdentityProvider({ url: URL_BASE, secretKey: SECRET, fetch });

    expect(await idp.findLogin("jdoe@staff.cvh.invalid")).toEqual({ authUserId: USER_ID, createdAt: new Date("2026-01-02T00:00:00Z"), staffMarker: true });
    expect(await idp.findLogin("other@staff.cvh.invalid")).toMatchObject({ authUserId: "u1", staffMarker: false });
    expect(await idp.findLogin("nobody@staff.cvh.invalid")).toBeNull();
    expect(calls[0]).toMatchObject({ method: "GET" });
    expect(calls[0].url).toContain("/auth/v1/admin/users");
  });

  it("finds a verified TOTP factor, and ignores unverified ones", async () => {
    const factors = (list: unknown[]) => fakeFetch(() => ({ status: 200, body: list }));
    const verified = factors([{ id: "f1", factor_type: "totp", status: "verified" }]);
    const unverified = factors([{ id: "f2", factor_type: "totp", status: "unverified" }]);

    expect(await supabaseIdentityProvider({ url: URL_BASE, secretKey: SECRET, fetch: verified.fetch }).hasVerifiedAuthenticator(USER_ID)).toBe(true);
    expect(verified.calls[0]).toMatchObject({ url: `${URL_BASE}/auth/v1/admin/users/${USER_ID}/factors`, method: "GET" });
    expect(await supabaseIdentityProvider({ url: URL_BASE, secretKey: SECRET, fetch: unverified.fetch }).hasVerifiedAuthenticator(USER_ID)).toBe(false);
  });
});
