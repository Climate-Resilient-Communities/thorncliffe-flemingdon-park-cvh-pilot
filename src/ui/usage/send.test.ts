import { describe, expect, it, vi } from "vitest";
import type { UsageEvent } from "@/contracts/usage";
import { sendUsage, usageBody } from "./send";

// S02.15: the phone sends one fixed message and nothing else; offline it is dropped, never queued.

const ok = () => vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));

describe("sendUsage", () => {
  it("posts exactly {evt, lang} (or with nbhd), with no credentials, no referrer and no cache", async () => {
    const fetcher = ok();

    expect(await sendUsage({ evt: "map_view", lang: "ta", nbhd: "TP" }, { fetcher, online: () => true })).toBe(true);
    expect(await sendUsage({ evt: "guide_view", lang: "en" }, { fetcher, online: () => true })).toBe(true);

    const [first, second] = fetcher.mock.calls;
    expect(first[0]).toBe("/api/metrics");
    expect(first[1]).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(JSON.parse(String(first[1]?.body))).toEqual({ evt: "map_view", lang: "ta", nbhd: "TP" });
    expect(JSON.parse(String(second[1]?.body))).toEqual({ evt: "guide_view", lang: "en" });
    expect(Object.keys(first[1]?.headers ?? {})).toEqual(["Content-Type"]);
  });

  it("drops the event without signal: nothing is sent and nothing is kept to send later", async () => {
    const fetcher = ok();

    expect(await sendUsage({ evt: "install", lang: "en" }, { fetcher, online: () => false })).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    // Signal back: no earlier event comes with it.
    expect(await sendUsage({ evt: "numbers_view", lang: "en" }, { fetcher, online: () => true })).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sends nothing from the one-time web link's page or its API (S07.06), in any language, and sends from every other page", async () => {
    const fetcher = ok();
    const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";

    for (const page of [`/en/subscription/${token}`, `/ur/subscription/${token}`, "/prs/subscription/x", "/api/subscription/view"]) {
      expect(await sendUsage({ evt: "install", lang: "en" }, { fetcher, online: () => true, page: () => page }), page).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();
    for (const page of ["/en", "/en/text-alerts", "/en/subscriptions", "/staff/subscription"]) {
      expect(await sendUsage({ evt: "install", lang: "en" }, { fetcher, online: () => true, page: () => page }), page).toBe(true);
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("never throws and never retries: a failed request or an error answer is just not counted", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const refused = vi.fn(async () => new Response("{}", { status: 503 }));

    expect(await sendUsage({ evt: "install", lang: "en" }, { fetcher: down, online: () => true })).toBe(false);
    expect(await sendUsage({ evt: "install", lang: "en" }, { fetcher: refused, online: () => true })).toBe(false);
    expect(down).toHaveBeenCalledTimes(1);
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("gives up on a request that hangs, so the page and the install flag are not held", async () => {
    const hung = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")))));

    expect(await sendUsage({ evt: "install", lang: "en" }, { fetcher: hung, online: () => true, timeoutMs: 20 })).toBe(false);
    expect(hung.mock.calls[0][1]?.signal).toBeDefined();
  });

  it("asks for keepalive only when told to", async () => {
    const fetcher = ok();

    await sendUsage({ evt: "install", lang: "en" }, { fetcher, online: () => true, keepalive: true });
    await sendUsage({ evt: "map_view", lang: "en" }, { fetcher, online: () => true });

    expect(fetcher.mock.calls[0][1]?.keepalive).toBe(true);
    expect(fetcher.mock.calls[1][1]?.keepalive).toBeUndefined();
  });

  it("rebuilds the body from the three allowed fields: anything extra in the object is refused, not sent", async () => {
    const fetcher = ok();
    const sneaky = { evt: "install", lang: "en", rsn: "123", groups: ["seniors"] } as unknown as UsageEvent;

    expect(await sendUsage(sneaky, { fetcher, online: () => true })).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => usageBody(sneaky)).toThrow();
    expect(usageBody({ evt: "install", lang: "en" })).toBe('{"evt":"install","lang":"en"}');
  });
});
