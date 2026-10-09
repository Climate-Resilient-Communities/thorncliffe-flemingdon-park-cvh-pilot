import { describe, expect, it, vi } from "vitest";
import type { UsageEvent } from "@/contracts/usage";
import { INSTALL_FLAG_KEY, isStandalone, reportInstall, type InstallDeps } from "./install";

// S02.15, FR-M1: one install event per phone, stopped by a true/false flag; not sent without signal.

function setup(over: Partial<InstallDeps> = {}) {
  const data = new Map<string, string>();
  const sent: UsageEvent[] = [];
  const all: InstallDeps = {
    storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) },
    online: () => true,
    neighbourhood: async () => undefined,
    send: async (event) => {
      sent.push(event);
      return true;
    },
    leaving: async () => false,
    ...over,
  };
  return { all, data, sent };
}

describe("reportInstall", () => {
  it("sends one install event and sets the flag, a plain 1 and not an identifier", async () => {
    const { all, data, sent } = setup();

    expect(await reportInstall("ur", all)).toBe("sent");

    expect(sent).toEqual([{ evt: "install", lang: "ur" }]);
    expect(data.get(INSTALL_FLAG_KEY)).toBe("1");
    expect([...data.keys()]).toEqual([INSTALL_FLAG_KEY]);
  });

  it("does not send again once the flag is set, however often it is asked", async () => {
    const { all, sent } = setup();

    expect(await reportInstall("en", all)).toBe("sent");
    expect(await reportInstall("en", all)).toBe("already");
    expect(await reportInstall("fr", all)).toBe("already");
    expect(sent).toHaveLength(1);
  });

  it("sends one event when both signals arrive at once (appinstalled and the standalone open)", async () => {
    const { all, sent } = setup();

    const outcomes = await Promise.all([reportInstall("en", all), reportInstall("en", all)]);

    expect([...outcomes].sort()).toEqual(["already", "sent"]);
    expect(sent).toHaveLength(1);
  });

  it("carries the neighbourhood the chosen buildings are all in, when there is one, and leaves it out otherwise", async () => {
    const withOne = setup({ neighbourhood: async () => "FP" });
    const failing = setup({ neighbourhood: async () => Promise.reject(new Error("list down")) });

    await reportInstall("en", withOne.all);
    await reportInstall("en", failing.all);

    expect(withOne.sent).toEqual([{ evt: "install", lang: "en", nbhd: "FP" }]);
    expect(failing.sent).toEqual([{ evt: "install", lang: "en" }]);
  });

  it("drops the event without signal and does not set the flag, so the next standalone open can count it", async () => {
    const neighbourhood = vi.fn(async () => undefined);
    const { all, data, sent } = setup({ online: () => false, neighbourhood });

    expect(await reportInstall("en", all)).toBe("offline");

    expect(sent).toEqual([]);
    expect(data.size).toBe(0);
    expect(neighbourhood).not.toHaveBeenCalled();
  });

  it("sends nothing when the phone cannot keep the flag, since it could not be stopped from sending again", async () => {
    const blocked = setup({ storage: null });
    const full = setup({
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => undefined,
      },
    });
    const unreadable = setup({
      storage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });

    for (const d of [blocked, full, unreadable]) expect(await reportInstall("en", d.all)).toBe("no-flag");
    expect([...blocked.sent, ...full.sent, ...unreadable.sent]).toEqual([]);
  });

  it("takes the flag back when the server did not count the event, so the next open tries again", async () => {
    const { all, data } = setup({ send: async () => false });

    expect(await reportInstall("en", all)).toBe("failed");
    expect(data.has(INSTALL_FLAG_KEY)).toBe(false);
  });

  it("keeps the flag when the send failed because the page was going away: the request goes on to the server without it", async () => {
    let leaving = false;
    const { all, data, sent } = setup({
      send: async (event) => {
        sent.push(event);
        // The page is reloaded while the event is on its way; the browser then tells the page the request failed.
        leaving = true;
        return false;
      },
      leaving: async () => leaving,
    });

    expect(await reportInstall("en", all)).toBe("left");
    expect(data.get(INSTALL_FLAG_KEY)).toBe("1");
    // The reloaded page sends nothing more.
    expect(await reportInstall("en", all)).toBe("already");
    expect(sent).toHaveLength(1);
  });

  it("leaves the flag set when the page is gone before it can be told whether it was leaving", async () => {
    const { all, data } = setup({ send: async () => false, leaving: () => new Promise<boolean>(() => {}) });

    void reportInstall("en", all);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(data.get(INSTALL_FLAG_KEY)).toBe("1");
  });
});

describe("isStandalone", () => {
  it("is true for the standalone display mode and for iOS's own flag, false otherwise or when asking fails", () => {
    const win = (matches: boolean, standalone?: boolean) => ({ matchMedia: () => ({ matches }), navigator: { standalone } });

    expect(isStandalone(win(true))).toBe(true);
    expect(isStandalone(win(false, true))).toBe(true);
    expect(isStandalone(win(false))).toBe(false);
    expect(
      isStandalone({
        matchMedia: () => {
          throw new Error("no");
        },
        navigator: {},
      }),
    ).toBe(false);
  });
});
