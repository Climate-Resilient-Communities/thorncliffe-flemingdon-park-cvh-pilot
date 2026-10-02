import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminShortfallBanner } from "./AdminShortfallBanner";
import { showAdminShortfallBanner } from "./adminShortfall";

const ADMIN = "01900000-0000-7000-8000-000000000001";

describe("the Fewer than two usable Admins banner (S01.06)", () => {
  it("is asked of the identity module for the signed-in staff member", async () => {
    const adminShortfallBanner = vi.fn(async () => true);

    const shown = await showAdminShortfallBanner({ session: async () => ({ staffId: ADMIN }), identity: () => ({ adminShortfallBanner }), logError: vi.fn() });

    expect(shown).toBe(true);
    expect(adminShortfallBanner).toHaveBeenCalledWith(ADMIN);
  });

  it("is not shown without a session, and the identity module is not asked", async () => {
    const identity = vi.fn();

    expect(await showAdminShortfallBanner({ session: async () => null, identity, logError: vi.fn() })).toBe(false);
    expect(identity).not.toHaveBeenCalled();
  });

  it("leaves the screen working when the check fails, and logs the failure without its message", async () => {
    const logError = vi.fn();
    const identity = () => ({
      adminShortfallBanner: async () => {
        throw new TypeError("jane@example.org");
      },
    });

    expect(await showAdminShortfallBanner({ session: async () => ({ staffId: ADMIN }), identity, logError })).toBe(false);
    expect(logError).toHaveBeenCalledWith({ error: "TypeError" });
  });

  it("shows no banner when the check hangs, within the timeout, and logs without any message text", async () => {
    const logError = vi.fn();
    const identity = () => ({ adminShortfallBanner: () => new Promise<boolean>(() => {}) });
    const started = Date.now();

    expect(await showAdminShortfallBanner({ session: async () => ({ staffId: ADMIN }), identity, logError, timeoutMs: 30 })).toBe(false);

    expect(Date.now() - started).toBeLessThan(1000);
    expect(logError).toHaveBeenCalledWith({ error: "BannerTimeout" });
  });

  it("waits two seconds by default", async () => {
    vi.useFakeTimers();
    try {
      const logError = vi.fn();
      const identity = () => ({ adminShortfallBanner: () => new Promise<boolean>(() => {}) });
      const pending = showAdminShortfallBanner({ session: async () => ({ staffId: ADMIN }), identity, logError });

      await vi.advanceTimersByTimeAsync(1999);
      expect(logError).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toBe(false);
      expect(logError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says what is wrong and what to do, as a status", () => {
    const html = renderToStaticMarkup(<AdminShortfallBanner />);

    expect(html).toContain('role="status"');
    expect(html).toContain("Fewer than two usable Admins");
    expect(html).toContain("Restore a second usable Admin");
  });
});
