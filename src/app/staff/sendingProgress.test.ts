// Whether texts are paused, as the progress view asks (S06.09): the switch's answer, a missing row counting as paused (the sender holds every text then) and a
// failure to read it logged by the error's name and counted as not paused. The pause itself is faked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessagingControlMissing } from "@/modules/messaging";

const status = vi.fn();
const logPauseError = vi.fn();
vi.mock("./messagingPause", () => ({ messagingPause: () => ({ status }), logPauseError: (...args: unknown[]) => logPauseError(...args) }));

const { textsArePaused } = await import("./sendingProgress");

beforeEach(() => {
  status.mockReset();
  logPauseError.mockReset();
});

describe("whether texts are paused, for the sending progress", () => {
  it("follows the switch", async () => {
    status.mockResolvedValueOnce({ paused: true, pausedBy: "x", pausedAt: new Date(), reason: "wrong alert", handedOffAtPause: 3 });
    expect(await textsArePaused()).toBe(true);
    status.mockResolvedValueOnce({ paused: false });
    expect(await textsArePaused()).toBe(false);
    expect(logPauseError).not.toHaveBeenCalled();
  });

  it("counts a switch with no row as paused, as the sender does, and logs it", async () => {
    status.mockRejectedValueOnce(new MessagingControlMissing());
    expect(await textsArePaused()).toBe(true);
    expect(logPauseError).toHaveBeenCalledWith("messaging.pause_status_failed", { error: "MessagingControlMissing" });
  });

  it("counts a switch that cannot be read as not paused and logs the error's name only", async () => {
    status.mockRejectedValueOnce(new Error("connection refused to db.example"));
    expect(await textsArePaused()).toBe(false);
    expect(logPauseError).toHaveBeenCalledWith("messaging.pause_status_failed", { error: "Error" });
    expect(JSON.stringify(logPauseError.mock.calls)).not.toContain("db.example");
  });
});
