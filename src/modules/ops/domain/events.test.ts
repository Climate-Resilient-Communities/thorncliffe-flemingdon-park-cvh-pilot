import { describe, expect, it } from "vitest";
import { OPS_EVENT_KINDS, OpsEventError, PUBLISH_FAILURE_REASONS, toOpsEventRecord } from "./events";

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
      for (const key of Object.keys(spec.detail.shape)) expect(key, `${kind}.${key}`).not.toMatch(/message|text|body|phone|email|name|error/i);
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
