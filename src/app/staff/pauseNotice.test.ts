import { describe, expect, it, vi } from "vitest";

vi.mock("./messagingPause", () => ({ messagingPause: () => ({}), logPauseError: () => {} }));

const { pauseNoticeForApprover } = await import("./pauseNotice");

describe("the approver's notice while texts are paused (S06.06)", () => {
  it("is 'Texts are paused; this will send when resumed' while texts are paused", async () => {
    expect(await pauseNoticeForApprover({ paused: async () => true, logError: vi.fn() })).toBe("Texts are paused; this will send when resumed");
  });

  it("is nothing while texts are going out", async () => {
    expect(await pauseNoticeForApprover({ paused: async () => false, logError: vi.fn() })).toBeNull();
  });

  it("shows nothing, and logs only the error's name, when the switch cannot be read: the text queues either way", async () => {
    const logError = vi.fn();

    const notice = await pauseNoticeForApprover({
      paused: async () => {
        throw new TypeError("postgres://user:secret@host");
      },
      logError,
    });

    expect(notice).toBeNull();
    expect(logError).toHaveBeenCalledWith("messaging.pause_notice_failed", { error: "TypeError" });
  });
});
