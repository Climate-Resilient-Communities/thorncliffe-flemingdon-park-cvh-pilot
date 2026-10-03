import { describe, expect, it, vi } from "vitest";
import { loadSenderBanner, senderBannerView } from "./senderBanner";

const SINCE = new Date("2026-10-05T18:15:00Z");
const LATER = new Date("2026-10-05T18:40:00Z");

describe("the banner while the sender is failing (S06.07)", () => {
  it("shows nothing when no sender condition holds", () => {
    expect(senderBannerView([])).toBeNull();
  });

  it("says what is wrong, since when and whom to tell, for a stuck queue", () => {
    expect(senderBannerView([{ condition: "queue_stuck", since: SINCE }])).toEqual({
      heading: "Sending is failing",
      lines: [
        "Texts have waited more than 5 minutes to be sent. Texts to the on-call Admins may be late too.",
        "Since Oct 5, 2026, 2:15 p.m.",
        "Tell IT now.",
      ],
    });
  });

  it("says both when both hold, naming the earlier start", () => {
    const view = senderBannerView([
      { condition: "sender_stalled", since: LATER },
      { condition: "queue_stuck", since: SINCE },
    ]);
    expect(view?.lines).toEqual([
      "Texts have waited more than 5 minutes to be sent. Texts to the on-call Admins may be late too.",
      "No sender has run for more than 3 minutes while texts are waiting. Texts to the on-call Admins may be late too.",
      "Since Oct 5, 2026, 2:15 p.m.",
      "Tell IT now.",
    ]);
  });

  it("is loaded from what the health job remembered", async () => {
    const view = await loadSenderBanner({ active: async () => [{ condition: "sender_stalled", since: SINCE }], logError: () => {} });
    expect(view?.heading).toBe("Sending is failing");
  });

  it("never holds a screen back: a failed or slow check shows no banner and is logged by the error's name", async () => {
    const logError = vi.fn();
    expect(await loadSenderBanner({ active: async () => Promise.reject(new TypeError("connection refused to 10.0.0.1")), logError })).toBeNull();
    expect(logError).toHaveBeenCalledWith({ error: "TypeError" });

    const slow = vi.fn();
    expect(await loadSenderBanner({ active: () => new Promise(() => {}), logError: slow, timeoutMs: 10 })).toBeNull();
    expect(slow).toHaveBeenCalledWith({ error: "BannerTimeout" });
  });
});
