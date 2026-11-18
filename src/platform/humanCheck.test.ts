import { describe, expect, it, vi } from "vitest";
import { checkHuman, humanCheckSiteKey, readHumanCheckConfig } from "./humanCheck";

const CONFIG = { siteKey: "site", secret: "secret" };
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("the human check (session 2, #2 and #12)", () => {
  it("is off unless both keys are set", () => {
    expect(readHumanCheckConfig({})).toBeNull();
    expect(readHumanCheckConfig({ TURNSTILE_SITE_KEY: "site" })).toBeNull();
    expect(readHumanCheckConfig({ TURNSTILE_SECRET_KEY: "secret", TURNSTILE_SITE_KEY: "  " })).toBeNull();
    expect(readHumanCheckConfig({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" })).toEqual(CONFIG);
    expect(humanCheckSiteKey({})).toBeNull();
    expect(humanCheckSiteKey({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" })).toBe("site");
  });

  it("asks nothing of Cloudflare while it is off", async () => {
    const fetcher = answer({ success: true });
    expect(await checkHuman(null, undefined, fetcher)).toBe("off");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails without a token, without asking Cloudflare", async () => {
    const fetcher = answer({ success: true });
    expect(await checkHuman(CONFIG, undefined, fetcher)).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the secret and the token, and never the client's address", async () => {
    const fetcher = answer({ success: true });
    expect(await checkHuman(CONFIG, "token", fetcher)).toBe("passed");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ secret: "secret", response: "token" });
  });

  it("fails for a token Cloudflare says is not good", async () => {
    expect(await checkHuman(CONFIG, "token", answer({ success: false, "error-codes": ["invalid-input-response"] }))).toBe("failed");
    expect(await checkHuman(CONFIG, "token", answer({ success: false, "error-codes": ["timeout-or-duplicate"] }))).toBe("failed");
  });

  it("lets the form through when Cloudflare cannot answer, or our secret is wrong: a resident is never kept from alerts by it", async () => {
    expect(await checkHuman(CONFIG, "token", answer({ success: false, "error-codes": ["invalid-input-secret"] }))).toBe("unavailable");
    expect(await checkHuman(CONFIG, "token", answer({ success: false, "error-codes": ["internal-error"] }))).toBe("unavailable");
    expect(await checkHuman(CONFIG, "token", answer({}, 500))).toBe("unavailable");
    expect(await checkHuman(CONFIG, "token", answer("not json"))).toBe("unavailable");
    expect(await checkHuman(CONFIG, "token", vi.fn(async () => Promise.reject(new Error("offline"))))).toBe("unavailable");
  });
});
