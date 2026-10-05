import { describe, expect, it, vi } from "vitest";
import { HEALTH_CONDITIONS, SENDER_CONDITIONS, type HealthCondition } from "@/modules/ops";
import { healthBannerView, loadHealthBanner, seesEveryCondition, type HealthBannerFacts } from "./healthBannerModel";

const SINCE = new Date("2026-10-05T18:15:00Z");
const LATER = new Date("2026-10-05T18:40:00Z");
const BEATING = { completedAt: LATER, fresh: true };
const facts = (active: HealthBannerFacts["active"], heartbeat: HealthBannerFacts["heartbeat"] = BEATING): HealthBannerFacts => ({ active, heartbeat });
const EVERYTHING = { everything: true };
const SENDER_ONLY = { everything: false };

describe("the banner while the sender is failing (S06.07), as everyone at the Hub sees it", () => {
  it("shows nothing when no condition holds", () => {
    expect(healthBannerView(facts([]), EVERYTHING)).toBeNull();
    expect(healthBannerView(facts([]), SENDER_ONLY)).toBeNull();
  });

  it("says what is wrong, since when and whom to tell, for a stuck queue", () => {
    expect(healthBannerView(facts([{ condition: "queue_stuck", since: SINCE }]), SENDER_ONLY)).toEqual({
      heading: "Sending is failing",
      lines: [
        "Texts have waited more than 5 minutes to be sent. Texts to the on-call Admins may be late too.",
        "Since Oct 5, 2026, 2:15 p.m.",
        "Tell IT now.",
      ],
    });
  });

  it("says both when both hold, naming the earlier start", () => {
    const view = healthBannerView(
      facts([
        { condition: "sender_stalled", since: LATER },
        { condition: "queue_stuck", since: SINCE },
      ]),
      SENDER_ONLY,
    );
    expect(view?.lines).toEqual([
      "Texts have waited more than 5 minutes to be sent. Texts to the on-call Admins may be late too.",
      "No sender has run for more than 3 minutes while texts are waiting. Texts to the on-call Admins may be late too.",
      "Since Oct 5, 2026, 2:15 p.m.",
      "Tell IT now.",
    ]);
  });

  it("shows everyone Twilio refusing the sign-in, as sending that is failing (S09.01 follow-up)", () => {
    expect(healthBannerView(facts([{ condition: "provider_auth", since: SINCE }]), SENDER_ONLY)).toEqual({
      heading: "Sending is failing",
      lines: [
        "Twilio refused the CVH sign-in, so texts are not being sent. Texts to the on-call Admins may not arrive either.",
        "Since Oct 5, 2026, 2:15 p.m.",
        "Tell IT now.",
      ],
    });
  });

  it("does not show an Ambassador or a Director the conditions that are not the sender failing, nor a stopped health check", () => {
    const others = HEALTH_CONDITIONS.filter((condition) => !(SENDER_CONDITIONS as readonly HealthCondition[]).includes(condition)).map((condition) => ({ condition, since: SINCE }));
    expect(healthBannerView(facts(others, { completedAt: SINCE, fresh: false }), SENDER_ONLY)).toBeNull();
    expect(seesEveryCondition("ambassador")).toBe(false);
    expect(seesEveryCondition("director")).toBe(false);
  });
});

describe("the banner on every Admin and Coordinator screen (S09.01)", () => {
  it("is for Admins and Coordinators", () => {
    expect(seesEveryCondition("admin")).toBe(true);
    expect(seesEveryCondition("coordinator")).toBe(true);
  });

  it("names every condition in plain words, each on its own line, with no code in it", () => {
    const view = healthBannerView(facts(HEALTH_CONDITIONS.map((condition) => ({ condition, since: SINCE }))), EVERYTHING);
    expect(view?.heading).toBe("Sending is failing");
    expect(view?.lines).toHaveLength(HEALTH_CONDITIONS.length + 2);
    for (const line of view?.lines ?? []) {
      expect(line).not.toMatch(/[a-z]+_[a-z]+/);
      expect(line).not.toMatch(/\{|\}|staff\.health/);
    }
    expect(new Set(view?.lines).size).toBe(view?.lines.length);
  });

  it.each([
    ["delivery_unknown", "Some texts may or may not have arrived: the provider did not say what happened to them."],
    ["smart_encoding_on", "Smart Encoding is on in the Twilio Messaging Service, so texts may arrive with characters changed."],
    ["signature_failures", "Many messages from Twilio failed the signature check in the last 10 minutes."],
    ["job_failed", "A scheduled job failed in the last 10 minutes, for example sending, closing expired alerts or this check."],
    ["translation_fallback", "An alert was submitted in the last 24 hours with a whole language in English, because its translation failed."],
    ["publish_failed", "The last directory publish failed. Residents still see the previous directory."],
    ["transactional_ceiling", "More sign-up and reply texts were sent today than the daily limit. They keep sending. Someone may be misusing the sign-up form."],
    ["cap_overrun", "An approval this month went over the monthly text message spending cap. Texts keep sending."],
    ["messaging_settings", "The Twilio Messaging Service allows texts to countries other than Canada, or SMS pumping protection is off. Someone could run up texting costs."],
  ] as const)("names %s as %j under 'Something is not working' when the sender is fine", (condition, line) => {
    expect(healthBannerView(facts([{ condition, since: SINCE }]), EVERYTHING)).toEqual({
      heading: "Something is not working",
      lines: [line, "Since Oct 5, 2026, 2:15 p.m.", "Tell IT now."],
    });
  });

  it("says the health check has stopped when it ran once and has not completed for 3 minutes, but not when it never ran", () => {
    expect(healthBannerView(facts([], { completedAt: SINCE, fresh: false }), EVERYTHING)).toEqual({
      heading: "Something is not working",
      lines: ["The health check has not run for more than 3 minutes, so a new problem may not be shown here.", "Since Oct 5, 2026, 2:15 p.m.", "Tell IT now."],
    });
    expect(healthBannerView(facts([], { completedAt: null, fresh: false }), EVERYTHING)).toBeNull();
    const both = healthBannerView(facts([{ condition: "queue_stuck", since: LATER }], { completedAt: SINCE, fresh: false }), EVERYTHING);
    expect(both?.heading).toBe("Sending is failing");
    expect(both?.lines.at(-2)).toBe("Since Oct 5, 2026, 2:15 p.m.");
  });

  it("is loaded from what the health job remembered", async () => {
    const view = await loadHealthBanner({ facts: async () => facts([{ condition: "publish_failed", since: SINCE }]), everything: true, logError: () => {} });
    expect(view?.heading).toBe("Something is not working");
    expect(await loadHealthBanner({ facts: async () => facts([{ condition: "publish_failed", since: SINCE }]), everything: false, logError: () => {} })).toBeNull();
  });

  it("never holds a screen back: a failed or slow check shows no banner and is logged by the error's name", async () => {
    const logError = vi.fn();
    expect(await loadHealthBanner({ facts: async () => Promise.reject(new TypeError("connection refused to 10.0.0.1")), everything: true, logError })).toBeNull();
    expect(logError).toHaveBeenCalledWith({ error: "TypeError" });

    const slow = vi.fn();
    expect(await loadHealthBanner({ facts: () => new Promise(() => {}), everything: true, logError: slow, timeoutMs: 10 })).toBeNull();
    expect(slow).toHaveBeenCalledWith({ error: "BannerTimeout" });
  });
});
