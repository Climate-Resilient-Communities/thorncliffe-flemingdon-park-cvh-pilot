import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { HEALTH_CONDITIONS, OPS_EVENT_KINDS, OpsEventError, PUBLISH_FAILURE_REASONS, toOpsEventRecord } from "./events";

describe("ops events", () => {
  it("turns a failed publish into a row: kind, severity, subject and a detail of codes and counts", () => {
    expect(
      toOpsEventRecord({
        kind: "directory.publish_failed",
        subjectType: "directory_release",
        subjectId: "4",
        detail: { reason: "storage_unavailable", attempts: 3, files_stored: 5 },
      }),
    ).toEqual({
      kind: "directory.publish_failed",
      severity: "error",
      subjectType: "directory_release",
      subjectId: "4",
      detail: { reason: "storage_unavailable", attempts: 3, files_stored: 5 },
    });
  });

  it("needs no subject (a publish that failed before a release was made)", () => {
    expect(toOpsEventRecord({ kind: "directory.publish_failed", detail: { reason: "invalid_catalogue", attempts: 1 } })).toMatchObject({ subjectType: null, subjectId: null });
  });

  it.each([
    ["a reason that is not a code of the list", { reason: "the files were gone", attempts: 1 }],
    ["a field outside the schema", { reason: "unexpected", attempts: 1, message: "ECONNREFUSED 10.0.0.1" }],
    ["a missing attempts count", { reason: "unexpected" }],
    ["a negative count", { reason: "unexpected", attempts: -1 }],
    ["a count that is text", { reason: "unexpected", attempts: "3" }],
  ])("rejects %s", (_name, detail) => {
    expect(() => toOpsEventRecord({ kind: "directory.publish_failed", detail } as never)).toThrow(OpsEventError);
  });

  it("rejects a kind it does not know", () => {
    expect(() => toOpsEventRecord({ kind: "something.else", detail: {} } as never)).toThrow(OpsEventError);
  });

  it("has no free-text field in any kind, and a lower_snake_case kind name the table accepts", () => {
    for (const [kind, spec] of Object.entries(OPS_EVENT_KINDS)) {
      expect(kind).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$/);
      for (const key of Object.keys(spec.detail.shape)) {
        if (key === "error") continue; // the one key that may carry "error", and only as a classification: the next test
        expect(key, `${kind}.${key}`).not.toMatch(/message|text|body|phone|email|name|error/i);
      }
    }
  });

  it("allows a key named error only where it is a safe classification, which refuses free text, a message and an address", () => {
    const withError = Object.entries(OPS_EVENT_KINDS).filter(([, spec]) => "error" in spec.detail.shape);

    expect(withError.map(([kind]) => kind).sort()).toEqual(["alert.expire_failed", "search.leg_failed", "search.unavailable"]);
    for (const [kind, spec] of withError) {
      const error = (spec.detail.shape as unknown as { error: z.ZodType }).error;
      for (const free of ["connection refused at 10.0.0.1", "took too long", "You are past the per-month limit", "2001:db8::1", "203.0.113.5", "schema:203.0.113.9", "a".repeat(81), "mujhe madad chahiye"]) {
        expect(error.safeParse(free).success, `${kind}.error accepts ${free}`).toBe(false);
      }
      for (const classification of ["42501", "timed_out", "timed_out:limiter", "ECONNREFUSED", "QueryEmbedError", "embed_failed:limited", "listing_schema:providers.0.name"]) {
        expect(error.safeParse(classification).success, `${kind}.error refuses ${classification}`).toBe(true);
      }
    }
  });

  it("turns a search that could not answer into a row of a reason and a duration, and refuses anything else (S03.04)", () => {
    expect(toOpsEventRecord({ kind: "search.unavailable", subjectType: "directory_release", subjectId: "2", detail: { reason: "timed_out", ms: 2203 } })).toEqual({
      kind: "search.unavailable",
      severity: "warning",
      subjectType: "directory_release",
      subjectId: "2",
      detail: { reason: "timed_out", ms: 2203 },
    });
    expect(toOpsEventRecord({ kind: "search.unavailable", detail: { reason: "rate_limit_failed", ms: 1003 } })).toMatchObject({ detail: { reason: "rate_limit_failed", ms: 1003 } });
    for (const error of ["42501", "timed_out", "PostgresError", "unknown", "listing_schema:providers.0.neighbourhood_ids", "CONNECT_TIMEOUT", "vectors_hash"]) {
      expect(toOpsEventRecord({ kind: "search.unavailable", detail: { reason: "rate_limit_failed", ms: 5, error } })).toMatchObject({ detail: { reason: "rate_limit_failed", ms: 5, error } });
    }
    for (const error of ["connection refused at 10.0.0.1", "203.0.113.5", "42501 ", "a".repeat(81), "", "a".repeat(64).replace(/a/g, "f"), "listing_schema: providers", "2001:db8::1", "schema:203.0.113.9", 42]) {
      expect(() => toOpsEventRecord({ kind: "search.unavailable", detail: { reason: "rate_limit_failed", ms: 5, error } } as never)).toThrow(OpsEventError);
    }
    // The route's hard deadline: a reason and how long the request had run, and nothing else.
    expect(toOpsEventRecord({ kind: "search.unavailable", detail: { reason: "deadline", ms: 2500 } })).toEqual({
      kind: "search.unavailable",
      severity: "warning",
      subjectType: null,
      subjectId: null,
      detail: { reason: "deadline", ms: 2500 },
    });
    for (const detail of [{ reason: "deadline" }, { reason: "deadline", ms: 2500, q: "میری عمارت میں آگ لگی ہے" }, { reason: "deadline", ms: -1 }]) {
      expect(() => toOpsEventRecord({ kind: "search.unavailable", detail } as never)).toThrow(OpsEventError);
    }
    // ... with the classification the route gives it (a timeout), which is a code as well.
    for (const error of ["timed_out", "timed_out:body", "timed_out:limiter", "timed_out:search"]) {
      expect(toOpsEventRecord({ kind: "search.unavailable", detail: { reason: "deadline", ms: 2500, error } })).toMatchObject({ detail: { reason: "deadline", ms: 2500, error } });
    }
    expect(() => toOpsEventRecord({ kind: "search.unavailable", detail: { reason: "deadline", ms: 2500, error: "took too long" } } as never)).toThrow(OpsEventError);
    for (const detail of [{ reason: "the question was ...", ms: 1 }, { reason: "timed_out", ms: 1, q: "x" }, { reason: "timed_out" }]) {
      expect(() => toOpsEventRecord({ kind: "search.unavailable", detail } as never)).toThrow(OpsEventError);
    }
    // A vendor call of a leg failed while the other leg answered (S03.05).
    expect(toOpsEventRecord({ kind: "search.leg_failed", subjectType: "directory_release", subjectId: "2", detail: { reason: "translate_failed", ms: 900 } })).toMatchObject({
      severity: "warning",
      detail: { reason: "translate_failed", ms: 900 },
    });
    for (const detail of [{ reason: "timed_out", ms: 1 }, { reason: "embed_failed", ms: 1, q: "x" }, { reason: "embed_failed" }]) {
      expect(() => toOpsEventRecord({ kind: "search.leg_failed", detail } as never)).toThrow(OpsEventError);
    }
    // A translation model past its limit, the fallback that rescued it, and a model near its monthly limit (a warning, no request: ms 0),
    // with the model id (a vendor name, not personal data).
    for (const reason of ["translate_quota", "translate_fallback_used", "translate_quota_near"] as const) {
      expect(toOpsEventRecord({ kind: "search.leg_failed", detail: { reason, ms: 300, model: "north-small-translate-09-2026" } })).toMatchObject({
        severity: "warning",
        detail: { reason, ms: 300, model: "north-small-translate-09-2026" },
      });
      expect(toOpsEventRecord({ kind: "search.leg_failed", detail: { reason, ms: 300 } })).toMatchObject({ detail: { reason, ms: 300 } });
    }
    expect(toOpsEventRecord({ kind: "search.leg_failed", detail: { reason: "translate_quota_near", ms: 0, model: "north-small-translate-09-2026" } })).toMatchObject({
      severity: "warning",
      detail: { reason: "translate_quota_near", ms: 0, model: "north-small-translate-09-2026" },
    });
    // The classification of the failed call is a code, like the one of a search that could not answer, and never a message.
    for (const [reason, error] of [["translate_quota", "translate_failed:quota"], ["translate_failed", "translate_failed:unavailable"], ["embed_failed", "42501"], ["embed_failed", "timed_out"]] as const) {
      expect(toOpsEventRecord({ kind: "search.leg_failed", detail: { reason, ms: 300, model: "north-small-translate-09-2026", error } })).toMatchObject({ detail: { reason, ms: 300, model: "north-small-translate-09-2026", error } });
    }
    for (const error of ["429 You are past the per-month limit", "203.0.113.5", "a".repeat(81), "", 7]) {
      expect(() => toOpsEventRecord({ kind: "search.leg_failed", detail: { reason: "translate_quota", ms: 1, error } } as never)).toThrow(OpsEventError);
    }
    for (const detail of [
      { reason: "translate_quota", ms: 1, model: "You are past the per-month request limit" },
      { reason: "translate_quota", ms: 1, model: "x".repeat(65) },
      { reason: "translate_quota", ms: 1, model: "m", message: "429" },
    ]) {
      expect(() => toOpsEventRecord({ kind: "search.leg_failed", detail } as never)).toThrow(OpsEventError);
    }
  });

  it("names the publish failure reasons the directory job gives", () => {
    expect([...PUBLISH_FAILURE_REASONS]).toEqual([
      "storage_unavailable",
      "invalid_catalogue",
      "catalogue_unreadable",
      "catalogue_not_loaded",
      "search_mismatch",
      "embedding_unavailable",
      "usage_allowance_exceeded",
      "search_config_invalid",
      "search_not_configured",
      "gave_up",
      "unexpected",
    ]);
  });
});

describe("the health job's events (S06.07)", () => {
  it("records a condition that texted the on-call Admins with codes and counts only", () => {
    expect(toOpsEventRecord({ kind: "health.condition_alerted", detail: { condition: "queue_stuck", count: 12, notified: 2, first: true } })).toEqual({
      kind: "health.condition_alerted",
      severity: "error",
      subjectType: null,
      subjectId: null,
      detail: { condition: "queue_stuck", count: 12, notified: 2, first: true },
    });
  });

  it("records a new episode inside the text interval as rate limited, with nobody texted", () => {
    expect(toOpsEventRecord({ kind: "health.condition_alerted", detail: { condition: "queue_stuck", count: 1, notified: 0, first: true, rate_limited: true } }).detail).toEqual({
      condition: "queue_stuck",
      count: 1,
      notified: 0,
      first: true,
      rate_limited: true,
    });
  });

  it("records a recovery as information", () => {
    expect(toOpsEventRecord({ kind: "health.condition_recovered", detail: { condition: "sender_stalled" } })).toMatchObject({ severity: "info", detail: { condition: "sender_stalled" } });
  });

  it("records that Smart Encoding was found off, for the end of an earlier finding that it was on", () => {
    expect(toOpsEventRecord({ kind: "messaging.smart_encoding_off", detail: {} })).toMatchObject({ severity: "info", detail: {} });
  });

  it.each([
    ["a condition that is not one of the five", { condition: "disk_full", count: 1, notified: 1, first: true }],
    ["a number in the detail", { condition: "queue_stuck", count: 1, notified: 1, first: true, number: "+14165550123" }],
    ["a name in the detail", { condition: "queue_stuck", count: 1, notified: 1, first: true, label: "IT lead" }],
    ["a count that is text", { condition: "queue_stuck", count: "12", notified: 1, first: true }],
    ["no first flag", { condition: "queue_stuck", count: 1, notified: 1 }],
  ])("rejects an alert event with %s", (_name, detail) => {
    expect(() => toOpsEventRecord({ kind: "health.condition_alerted", detail } as never)).toThrow(OpsEventError);
  });

  it("rejects a recovery event with anything but the condition", () => {
    expect(() => toOpsEventRecord({ kind: "health.condition_recovered", detail: { condition: "queue_stuck", note: "fixed" } } as never)).toThrow(OpsEventError);
  });

  it("records the expire job's events (S05.04): a thread that could not be closed (a failure class) and one closed late (minutes), and refuses anything else", () => {
    const subjectId = "01900000-0000-7000-8000-000000000001";
    expect(toOpsEventRecord({ kind: "alert.expire_failed", subjectType: "alert", subjectId, detail: { error: "ECONNRESET" } })).toMatchObject({ kind: "alert.expire_failed", severity: "error", detail: { error: "ECONNRESET" } });
    expect(toOpsEventRecord({ kind: "alert.expire_late", subjectType: "alert", subjectId, detail: { minutes_late: 90 } })).toMatchObject({ kind: "alert.expire_late", severity: "warning", detail: { minutes_late: 90 } });
    expect(() => toOpsEventRecord({ kind: "alert.expire_failed", detail: { error: "connection refused at 10.0.0.1" } })).toThrow(OpsEventError);
    expect(() => toOpsEventRecord({ kind: "alert.expire_late", detail: { minutes_late: -1 } })).toThrow(OpsEventError);
    expect(() => toOpsEventRecord({ kind: "alert.expire_late", detail: { minutes_late: 5, slug: "abc" } as never })).toThrow(OpsEventError);
  });

  it("records a spending cap overrun (S07.08's, read by the health job of S09.01) with a count only", () => {
    expect(toOpsEventRecord({ kind: "spend.cap_overrun", subjectType: "alert_entry", subjectId: "01900000-0000-7000-8000-000000000001", detail: { over_cents: 1250 } })).toMatchObject({
      kind: "spend.cap_overrun",
      severity: "warning",
      detail: { over_cents: 1250 },
    });
    expect(toOpsEventRecord({ kind: "spend.cap_overrun", detail: {} })).toMatchObject({ detail: {} });
    expect(() => toOpsEventRecord({ kind: "spend.cap_overrun", detail: { over_cents: -1 } })).toThrow(OpsEventError);
    expect(() => toOpsEventRecord({ kind: "spend.cap_overrun", detail: { approver: "Ann" } as never })).toThrow(OpsEventError);
  });

  it("names every condition of AD-23 (S06.07's five, S09.01's five and S07.09's)", () => {
    expect([...HEALTH_CONDITIONS]).toEqual([
      "queue_stuck",
      "delivery_unknown",
      "sender_stalled",
      "smart_encoding_on",
      "signature_failures",
      "job_failed",
      "translation_fallback",
      "publish_failed",
      "transactional_ceiling",
      "cap_overrun",
      "messaging_settings",
    ]);
  });

  it("records that the Messaging Service's abuse protections are wrong, as flags only, and that they were found right (S07.09)", () => {
    expect(toOpsEventRecord({ kind: "messaging.service_settings_wrong", detail: { geo_not_canada_only: true, pumping_protection_off: false } })).toMatchObject({
      severity: "error",
      detail: { geo_not_canada_only: true, pumping_protection_off: false },
    });
    expect(toOpsEventRecord({ kind: "messaging.service_settings_ok", detail: {} })).toMatchObject({ severity: "info", detail: {} });
    expect(() => toOpsEventRecord({ kind: "messaging.service_settings_wrong", detail: { geo_not_canada_only: true } as never })).toThrow(OpsEventError);
    expect(() => toOpsEventRecord({ kind: "messaging.service_settings_wrong", detail: { geo_not_canada_only: true, pumping_protection_off: true, countries: "US" } as never })).toThrow(OpsEventError);
  });
});
