import { describe, expect, it } from "vitest";
import type { PausedStatus } from "@/modules/messaging";
import { approverPauseNotice, formatWhen, handedOffLine, pausedBy, pausedView, pausedWhy, resumedLine, waitingLine } from "./view";

const status = (over: Partial<PausedStatus> = {}): PausedStatus => ({
  paused: true,
  pausedBy: "01900000-0000-7000-8000-0000000000a1",
  pausedAt: new Date("2026-10-05T18:15:00Z"),
  reason: "Wrong alert sent to Thorncliffe Park",
  handedOffAtPause: 3,
  ...over,
});

describe("the words of the pause", () => {
  it("say 'Texts are paused' with who paused, when (Toronto time) and why", () => {
    const view = pausedView(status(), "Ann Okafor");

    expect(view.heading).toBe("Texts are paused");
    expect(view.by).toBe("Paused by Ann Okafor on Oct 5, 2026, 2:15 p.m.");
    expect(view.why).toBe("Why: Wrong alert sent to Thorncliffe Park");
  });

  it("read the time in Toronto, not in UTC, and follow the change to standard time", () => {
    // 2026-10-05 18:15 UTC is 14:15 in Toronto (EDT); 2026-11-02 18:15 UTC is 13:15 (EST).
    expect(formatWhen(new Date("2026-10-05T18:15:00Z"))).toBe("Oct 5, 2026, 2:15 p.m.");
    expect(formatWhen(new Date("2026-11-02T18:15:00Z"))).toBe("Nov 2, 2026, 1:15 p.m.");
    // Just after midnight UTC is still the evening before in Toronto.
    expect(formatWhen(new Date("2026-10-06T01:30:00Z"))).toBe("Oct 5, 2026, 9:30 p.m.");
  });

  it("say 'an Admin' when the name of who paused cannot be read, so a pause is never left unexplained", () => {
    expect(pausedBy(status(), null)).toBe("Paused by an Admin on Oct 5, 2026, 2:15 p.m.");
  });

  it("show the reason as it was saved", () => {
    expect(pausedWhy(status({ reason: "Twilio is down." }))).toBe("Why: Twilio is down.");
  });

  it("tell the on-call line: texts to on-call Admins still go out, so the screen says so", () => {
    expect(pausedView(status(), "Ann").oncall).toBe("Texts to on-call Admins still go out during a pause, so a problem with sending is still reported.");
  });
});

describe("the texts already handed to the provider", () => {
  it("say '{n} texts were already handed to the provider and cannot be recalled'", () => {
    expect(handedOffLine(3)).toBe("3 texts were already handed to the provider and cannot be recalled");
    expect(handedOffLine(1200)).toBe("1200 texts were already handed to the provider and cannot be recalled");
    expect(pausedView(status({ handedOffAtPause: 3 }), "Ann").handedOff).toBe("3 texts were already handed to the provider and cannot be recalled");
  });

  it("say it in the singular for one text", () => {
    expect(handedOffLine(1)).toBe("1 text was already handed to the provider and cannot be recalled");
  });

  it("say nothing when none had been handed over, or the pause was set before the count existed", () => {
    expect(handedOffLine(0)).toBeNull();
    expect(handedOffLine(null)).toBeNull();
    expect(pausedView(status({ handedOffAtPause: 0 }), "Ann").handedOff).toBeNull();
    expect(pausedView(status({ handedOffAtPause: null }), "Ann").handedOff).toBeNull();
  });
});

describe("what a press says it did", () => {
  it("counts the texts waiting after a pause, in the number's grammar", () => {
    expect(waitingLine(12)).toBe("12 texts are waiting and will go out when you resume.");
    expect(waitingLine(1)).toBe("1 text is waiting and will go out when you resume.");
    expect(waitingLine(0)).toBe("No texts are waiting right now.");
  });

  it("counts the texts a resume lets go", () => {
    expect(resumedLine(12)).toBe("Texts resumed. 12 texts were waiting and now go out in order.");
    expect(resumedLine(1)).toBe("Texts resumed. 1 text was waiting and now goes out in order.");
    expect(resumedLine(0)).toBe("Texts resumed. No texts were waiting.");
  });
});

describe("the approver's notice", () => {
  it("is the sentence the story gives: the text queues, and goes when resumed", () => {
    expect(approverPauseNotice()).toBe("Texts are paused; this will send when resumed");
  });
});
