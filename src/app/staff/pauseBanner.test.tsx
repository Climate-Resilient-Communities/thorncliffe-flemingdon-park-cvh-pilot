import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MessagingControlMissing, type PauseStatus } from "@/modules/messaging";
import { PauseBanner } from "./PauseBanner";
import { loadPauseBanner, missingBanner, type PauseBannerDeps } from "./pauseBanner";

const PAUSER = "01900000-0000-7000-8000-0000000000a1";
const PAUSED: PauseStatus = { paused: true, pausedBy: PAUSER, pausedAt: new Date("2026-10-05T18:15:00Z"), reason: "Wrong alert sent to Thorncliffe Park", handedOffAtPause: 4 };

function deps(over: Partial<PauseBannerDeps> = {}): PauseBannerDeps {
  return { status: async () => PAUSED, nameOf: async () => "Ann Okafor", canResume: true, logError: vi.fn(), ...over };
}

describe("the 'Texts are paused' banner on every Hub screen (S06.06)", () => {
  it("says texts are paused, with who paused, when and why", async () => {
    const view = await loadPauseBanner(deps());

    expect(view).toEqual({
      heading: "Texts are paused",
      by: "Paused by Ann Okafor on Oct 5, 2026, 2:15 p.m.",
      why: "Why: Wrong alert sent to Thorncliffe Park",
      resume: { href: "/staff/texts", label: "Resume texts" },
    });
  });

  it("is asked of the pause for the name of whoever paused: the id is messaging's, the name is identity's", async () => {
    const nameOf = vi.fn(async () => "Ann Okafor");

    await loadPauseBanner(deps({ nameOf }));

    expect(nameOf).toHaveBeenCalledWith(PAUSER);
  });

  it("is not shown while texts are going out, and the name is not asked for", async () => {
    const nameOf = vi.fn();

    expect(await loadPauseBanner(deps({ status: async () => ({ paused: false }), nameOf }))).toBeNull();
    expect(nameOf).not.toHaveBeenCalled();
  });

  it("offers the link to resume only to a person who may resume", async () => {
    expect((await loadPauseBanner(deps({ canResume: false })))?.resume).toBeNull();
  });

  it("still says who paused when the name cannot be read: 'an Admin'", async () => {
    const view = await loadPauseBanner(
      deps({
        nameOf: async () => {
          throw new Error("db down");
        },
      }),
    );
    expect(view?.by).toBe("Paused by an Admin on Oct 5, 2026, 2:15 p.m.");
    expect(await loadPauseBanner(deps({ nameOf: async () => null }))).toMatchObject({ by: "Paused by an Admin on Oct 5, 2026, 2:15 p.m." });
  });

  it("leaves the screen working when the check fails, and logs the failure by the error's name", async () => {
    const logError = vi.fn();

    const view = await loadPauseBanner(
      deps({
        logError,
        status: async () => {
          throw new TypeError("jane@example.org");
        },
      }),
    );

    expect(view).toBeNull();
    expect(logError).toHaveBeenCalledWith({ error: "TypeError" });
  });

  it("says so when the pause switch has no row: the sender holds every text then, so the screen must not look as if texts go out", async () => {
    const logError = vi.fn();

    const view = await loadPauseBanner(
      deps({
        logError,
        canResume: true,
        status: async () => {
          throw new MessagingControlMissing();
        },
      }),
    );

    // No link to resume, even for an Admin: there is no switch to clear.
    expect(view).toEqual({
      heading: "Texts are not going out",
      by: "The pause switch is missing from the database, so every text is being held.",
      why: "Tell IT.",
      resume: null,
    });
    expect(logError).toHaveBeenCalledWith({ error: "MessagingControlMissing" });
  });

  it("leaves the screen working when the check hangs, within the timeout", async () => {
    const logError = vi.fn();
    const started = Date.now();

    expect(await loadPauseBanner(deps({ logError, status: () => new Promise<PauseStatus>(() => {}), timeoutMs: 30 }))).toBeNull();

    expect(Date.now() - started).toBeLessThan(1000);
    expect(logError).toHaveBeenCalledWith({ error: "BannerTimeout" });
  });

  it("waits two seconds by default", async () => {
    vi.useFakeTimers();
    try {
      const logError = vi.fn();
      const pending = loadPauseBanner(deps({ logError, status: () => new Promise<PauseStatus>(() => {}) }));

      await vi.advanceTimersByTimeAsync(1999);
      expect(logError).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toBeNull();
      expect(logError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the banner as it is drawn", () => {
  const view = {
    heading: "Texts are paused",
    by: "Paused by Ann Okafor on Oct 5, 2026, 2:15 p.m.",
    why: "Why: Wrong alert sent to Thorncliffe Park",
    resume: { href: "/staff/texts", label: "Resume texts" },
  };

  it("is a status, written out in words, with the link to resume for a person who may", () => {
    const html = renderToStaticMarkup(<PauseBanner view={view} />);

    expect(html).toContain('role="status"');
    expect(html).toContain("Texts are paused");
    expect(html).toContain("Paused by Ann Okafor on Oct 5, 2026, 2:15 p.m.");
    expect(html).toContain("Why: Wrong alert sent to Thorncliffe Park");
    expect(html).toContain('href="/staff/texts"');
    expect(html).toContain("Resume texts");
  });

  it("has no link for everyone else", () => {
    const html = renderToStaticMarkup(<PauseBanner view={{ ...view, resume: null }} />);

    expect(html).toContain("Texts are paused");
    expect(html).not.toContain("<a ");
  });

  it("draws the missing-switch banner as a status with no link, in words", () => {
    const html = renderToStaticMarkup(<PauseBanner view={missingBanner()} />);

    expect(html).toContain('role="status"');
    expect(html).toContain("Texts are not going out");
    expect(html).toContain("The pause switch is missing from the database, so every text is being held.");
    expect(html).toContain("Tell IT.");
    expect(html).not.toContain("<a ");
  });

  it("escapes the reason: it is typed by a person and shown to everyone", () => {
    const html = renderToStaticMarkup(<PauseBanner view={{ ...view, why: 'Why: <script>alert("x")</script>' }} />);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
