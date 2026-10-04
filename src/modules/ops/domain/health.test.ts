import { describe, expect, it } from "vitest";
import {
  ALERT_INTERVAL_MS,
  HEARTBEAT_STALE_AFTER_MS,
  PROVIDER_AUTH_RED_AFTER_MS,
  SENDER_CONDITIONS,
  decide,
  heartbeatCause,
  heartbeatFresh,
  intervalPassed,
  type ConditionState,
} from "./health";

const NOW = new Date("2026-10-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MINUTE = 60_000;

const idle: ConditionState = { active: false, since: null, lastAlertedAt: null, lastEventId: null };
const active = (lastAlertedAt: Date | null, lastEventId: number | null = null): ConditionState => ({ active: true, since: ago(10 * MINUTE), lastAlertedAt, lastEventId });

describe("the 30-minute interval", () => {
  it("is 30 minutes", () => {
    expect(ALERT_INTERVAL_MS).toBe(30 * MINUTE);
  });

  it("has passed for a condition never texted about, and exactly at 30 minutes, not before", () => {
    expect(intervalPassed(null, NOW)).toBe(true);
    expect(intervalPassed(ago(30 * MINUTE), NOW)).toBe(true);
    expect(intervalPassed(ago(30 * MINUTE - 1), NOW)).toBe(false);
    expect(intervalPassed(ago(MINUTE), NOW)).toBe(false);
  });
});

describe("a level condition (texts stuck, no sender running, signature failures)", () => {
  const holds = { holds: true, count: 4 };

  it("does nothing while it does not hold and was not raised", () => {
    expect(decide(idle, { holds: false, count: 0 }, NOW)).toEqual({ kind: "quiet" });
  });

  it("texts the on-call Admins when it begins", () => {
    expect(decide(idle, holds, NOW)).toEqual({ kind: "alert", begins: true });
  });

  it("holds its tongue for 30 minutes after a text, then reminds, and goes on reminding every 30 minutes while it holds", () => {
    expect(decide(active(ago(MINUTE)), holds, NOW)).toEqual({ kind: "hold", begins: false });
    expect(decide(active(ago(29 * MINUTE)), holds, NOW)).toEqual({ kind: "hold", begins: false });
    expect(decide(active(ago(30 * MINUTE)), holds, NOW)).toEqual({ kind: "alert", begins: false });
  });

  it("recovers when it stops holding, once: no text is sent for the recovery, and a later run is quiet", () => {
    expect(decide(active(ago(MINUTE)), { holds: false, count: 0 }, NOW)).toEqual({ kind: "recover" });
    expect(decide(idle, { holds: false, count: 0 }, NOW)).toEqual({ kind: "quiet" });
  });

  it("begins again after a recovery, but not within 30 minutes of the last text about it", () => {
    expect(decide({ ...idle, lastAlertedAt: ago(5 * MINUTE) }, holds, NOW)).toEqual({ kind: "hold", begins: true });
    expect(decide({ ...idle, lastAlertedAt: ago(31 * MINUTE) }, holds, NOW)).toEqual({ kind: "alert", begins: true });
  });
});

describe("an event condition (an unknown delivery, Smart Encoding found on)", () => {
  it("texts about a new event when it begins", () => {
    expect(decide(idle, { holds: true, count: 1, fresh: true }, NOW)).toEqual({ kind: "alert", begins: true });
  });

  it("does not repeat a text for events it has already told about, however long the condition lasts", () => {
    expect(decide(active(ago(31 * MINUTE), 40), { holds: true, count: 1, fresh: false }, NOW)).toEqual({ kind: "hold", begins: false });
    expect(decide(active(ago(24 * 60 * MINUTE), 40), { holds: true, count: 1, fresh: false }, NOW)).toEqual({ kind: "hold", begins: false });
  });

  it("texts about a newer event, once the interval has passed since the last text; inside the interval the event waits (it stays fresh)", () => {
    expect(decide(active(ago(5 * MINUTE), 40), { holds: true, count: 2, fresh: true }, NOW)).toEqual({ kind: "hold", begins: false });
    expect(decide(active(ago(30 * MINUTE), 40), { holds: true, count: 2, fresh: true }, NOW)).toEqual({ kind: "alert", begins: false });
  });

  it("recovers when nothing of its kind is left", () => {
    expect(decide(active(ago(5 * MINUTE), 40), { holds: false, count: 0, fresh: false }, NOW)).toEqual({ kind: "recover" });
  });
});

describe("the conditions that mean the sender itself is failing (the Hub's banner)", () => {
  it("are the stuck queue, the stalled sender and Twilio refusing the sign-in", () => {
    expect([...SENDER_CONDITIONS]).toEqual(["queue_stuck", "sender_stalled", "provider_auth"]);
  });
});

describe("the heartbeat (S09.01)", () => {
  it("is fresh for less than 3 minutes after the health job last judged every condition, and never before its first run", () => {
    expect(HEARTBEAT_STALE_AFTER_MS).toBe(3 * MINUTE);
    expect(heartbeatFresh(ago(0), NOW)).toBe(true);
    expect(heartbeatFresh(ago(3 * MINUTE - 1), NOW)).toBe(true);
    expect(heartbeatFresh(ago(3 * MINUTE), NOW)).toBe(false);
    expect(heartbeatFresh(ago(60 * MINUTE), NOW)).toBe(false);
    expect(heartbeatFresh(null, NOW)).toBe(false);
  });
});

describe("what the heartbeat names (S09.01 follow-up)", () => {
  const beating = ago(MINUTE);

  it("names nothing while the job is fresh and Twilio sign-in is not failing", () => {
    expect(heartbeatCause({ completedAt: beating, providerAuthSince: null }, NOW)).toBeNull();
  });

  it("names a stale job, or one that never ran, before anything it last remembered", () => {
    expect(heartbeatCause({ completedAt: null, providerAuthSince: null }, NOW)).toBe("health_job_stale");
    expect(heartbeatCause({ completedAt: ago(3 * MINUTE), providerAuthSince: null }, NOW)).toBe("health_job_stale");
    expect(heartbeatCause({ completedAt: ago(3 * MINUTE), providerAuthSince: ago(60 * MINUTE) }, NOW)).toBe("health_job_stale");
  });

  it("does not name a refusal that has held for less than 10 minutes (one that passes clears before), and names one that has held for 10", () => {
    expect(PROVIDER_AUTH_RED_AFTER_MS).toBe(10 * MINUTE);
    expect(heartbeatCause({ completedAt: beating, providerAuthSince: ago(0) }, NOW)).toBeNull();
    expect(heartbeatCause({ completedAt: beating, providerAuthSince: ago(10 * MINUTE - 1) }, NOW)).toBeNull();
    expect(heartbeatCause({ completedAt: beating, providerAuthSince: ago(10 * MINUTE) }, NOW)).toBe("provider_auth");
    expect(heartbeatCause({ completedAt: beating, providerAuthSince: ago(6 * 60 * MINUTE) }, NOW)).toBe("provider_auth");
  });
});
