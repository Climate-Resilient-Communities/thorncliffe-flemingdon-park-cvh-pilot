import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AUDIT_ACTIONS, AUDIT_META, AuditRecordError, findSensitiveValue, toAuditRecord, type AuditEvent } from "./actions";

const STAFF = "3f0b8f9e-6a51-4c1e-9d2a-0b6f1c2d3e4f";
const FLOOR = "9b2e4c1a-7d3f-4a5b-8c6d-1e2f3a4b5c6d";

const event = (overrides: Partial<AuditEvent> = {}): AuditEvent =>
  ({ action: "password.changed", actorStaffId: STAFF, subjectType: "staff_account", subjectId: STAFF, ...overrides }) as AuditEvent;

describe("audit actions", () => {
  it("covers every action S01.04 lists, with the concrete names the E01 stories use", () => {
    expect(AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        "account.created",
        "bootstrap.completed",
        "password.changed",
        "password.reset",
        "factor.enrolled",
        "factor.reset",
        "auth.signed_in",
        "auth.failed",
        "auth.locked",
        "session.revoked",
        "permission.denied",
        "seed.run",
        "sms.test_sent",
      ]),
    );
    for (const family of ["account.", "password.", "factor.", "building.", "assignment."]) {
      expect(AUDIT_ACTIONS.some((action) => action.startsWith(family)), family).toBe(true);
    }
  });

  it("gives no action a field that could hold a secret, a contact detail or a message", () => {
    const FORBIDDEN = /password|passcode|token|secret|otp|totp|phone|number|email|mail|body|message|text|username|name|ip/i;
    for (const [action, schema] of Object.entries(AUDIT_META)) {
      for (const key of Object.keys((schema as z.ZodObject).shape)) {
        expect(key, `${action}.meta.${key}`).not.toMatch(FORBIDDEN);
      }
    }
  });
});

describe("toAuditRecord", () => {
  it("builds the record with the outcome, defaults and the parsed meta", () => {
    expect(toAuditRecord(event({ action: "password.reset", meta: { admin_shortfall: true } }), "ok")).toEqual({
      action: "password.reset",
      actorStaffId: STAFF,
      subjectType: "staff_account",
      subjectId: STAFF,
      outcome: "ok",
      isDrill: false,
      meta: { admin_shortfall: true },
    });
  });

  it("accepts the system as actor and a refusal reason", () => {
    const record = toAuditRecord(
      event({ action: "auth.failed", actorStaffId: null, subjectId: null, meta: { reason: "wrong_password", attempts: 3 } }),
      "refused",
    );

    expect(record).toMatchObject({ actorStaffId: null, subjectId: null, outcome: "refused", meta: { reason: "wrong_password", attempts: 3 } });
  });

  it.each([
    ["account.created", { role: "admin", bootstrap: true }],
    ["account.role_changed", { from: "ambassador", to: "coordinator" }],
    ["account.suspended", { reason: "two_admin_rule" }],
    ["factor.reset", { admin_shortfall: true, recovery: "all_admins_lost_access" }],
    ["auth.signed_in", { aal: "aal2" }],
    ["auth.locked", { lock: "expired_starting_password" }],
    ["session.revoked", { cause: "role_changed", sessions: 2 }],
    ["permission.denied", { status: 403, reason: "out_of_scope", permission: "alert.approve", route: "/api/staff/accounts/[id]" }],
    ["building.floor_renamed", { floor_id: FLOOR, from: "13", to: "14" }],
    ["building.floor_removed", { floor_id: FLOOR, reason: "floor_has_assignments", assignments: 2 }],
    ["assignment.saved", { staff_id: STAFF, rsn: "4155426", floor_ids: null }],
    ["assignment.saved", { staff_id: STAFF, rsn: "4155426", floor_ids: [FLOOR] }],
    ["seed.run", { seed: "buildings", counts: { buildings: 43, floors: 812 }, warnings: 1 }],
    ["sms.test_sent", { http_status: 201, provider_status: "queued" }],
    ["sms.test_sent", { http_status: 400, provider_error_code: 30032, reason: "provider_error" }],
  ])("accepts %s with %j", (action, meta) => {
    expect(() => toAuditRecord(event({ action, meta } as Partial<AuditEvent>), "ok")).not.toThrow();
  });

  it("rejects a field outside the action's schema, naming the field but not its value", () => {
    const attempt = () => toAuditRecord(event({ meta: { password: "rvh-jane-doe" } as never }), "ok");

    expect(attempt).toThrow(AuditRecordError);
    expect(attempt).toThrow("password.changed: meta has fields outside the schema: password");
    expect(attempt).not.toThrow(/rvh-jane-doe/);
  });

  it.each([
    ["a token", "auth.signed_in", { aal: "aal2", token: "eyJhbGciOi" }],
    ["an authenticator secret", "factor.enrolled", { secret: "JBSWY3DPEHPK3PXP" }],
    ["a phone number", "sms.test_sent", { http_status: 201, to: "+14165550123" }],
    ["an email address", "account.created", { role: "admin", email: "jane@example.com" }],
    ["a message body", "sms.test_sent", { body: "CVH test from production" }],
    ["a username", "auth.failed", { username: "jdoe" }],
  ])("rejects %s", (_, action, meta) => {
    expect(() => toAuditRecord(event({ action, meta } as Partial<AuditEvent>), "refused")).toThrow(/fields outside the schema/);
  });

  it("does not echo a field name that could itself carry data", () => {
    expect(() => toAuditRecord(event({ meta: { "jane@example.com": 1 } as never }), "ok")).toThrow(
      "password.changed: meta has fields outside the schema: (unnamed)",
    );
  });

  it.each([
    ["a phone number as a seed count key", "seed.run", { seed: "buildings", counts: { "4165550123": 1 } }],
    ["a phone number as a count", "seed.run", { seed: "buildings", counts: { buildings: 4165550123 } }],
    ["an email address in a route", "permission.denied", { status: 403, route: "/api/staff/jane@example.com" }],
    ["a phone number in a route", "permission.denied", { status: 403, route: "/api/staff/416-555-0123" }],
    ["a wrong type", "auth.signed_in", { aal: "aal3" }],
    ["a missing required field", "session.revoked", {}],
  ])("rejects %s", (_, action, meta) => {
    expect(() => toAuditRecord(event({ action, meta } as Partial<AuditEvent>), "ok")).toThrow(AuditRecordError);
  });

  it("rejects an unknown action", () => {
    expect(() => toAuditRecord(event({ action: "account.deleted_everything" as never }), "ok")).toThrow("Unknown audit action");
  });

  it.each([
    ["an actor that is not a staff id", { actorStaffId: "jane" }],
    ["a subject type that is not a code", { subjectType: "Staff Account" }],
    ["a phone number as subject id", { subjectId: "+1 416 555 0123" }],
    ["an email address as subject id", { subjectId: "jane@example.com" }],
  ])("rejects %s", (_, overrides) => {
    expect(() => toAuditRecord(event(overrides as Partial<AuditEvent>), "ok")).toThrow(AuditRecordError);
  });

  it.each([
    ["a uuid", FLOOR],
    ["a small integer id", "4155426"],
    ["a lower_snake_case code", "guides_and_numbers"],
    ["a Twilio message SID", "SM0123456789abcdef0123456789abcdef"],
    ["a Twilio message SID with a long run of digits", "MM00000000000000000000000000000000"],
  ])("accepts %s as subject id", (_, subjectId) => {
    expect(() => toAuditRecord(event({ subjectId }), "ok")).not.toThrow();
  });

  it.each([
    ["colons", "416:555:0199"],
    ["underscores between digits", "416_555_0199"],
    ["a username with a dot", "jane.doe"],
    ["a kebab-case username", "rvh-jane-doe"],
    ["a ten digit number", "4165550199"],
    ["a SID of the wrong length", "SM0123"],
    ["an upper case SID", "SM0123456789ABCDEF0123456789ABCDEF"],
  ])("rejects %s as subject id", (_, subjectId) => {
    expect(() => toAuditRecord(event({ subjectId }), "ok")).toThrow(AuditRecordError);
  });

  it.each(["/api/staff/accounts/[id]", "/api/staff", "/staff/[staff_id]/sign-in"])(
    "accepts the route %s",
    (route) => {
      expect(() => toAuditRecord(event({ action: "permission.denied", meta: { status: 403, route } }), "ok")).not.toThrow();
    },
  );

  it.each([
    ["/api/staff/416/555/0199"],
    ["/api/x/416_555_0199"],
    ["/api/staff/jane.doe"],
    ["/staff/accounts/rvh-jane-doe-1"],
    ["/staff/accounts/Jane"],
    ["/staff/[id"],
    ["api/staff"],
    ["/"],
    ["/staff//accounts"],
  ])("rejects the route %s", (route) => {
    expect(() => toAuditRecord(event({ action: "permission.denied", meta: { status: 403, route } }), "ok")).toThrow(AuditRecordError);
  });

  it("keeps the drill flag", () => {
    expect(toAuditRecord(event({ isDrill: true }), "ok").isDrill).toBe(true);
  });
});

describe("error messages never echo values", () => {
  const messageOf = (meta: unknown) => {
    try {
      toAuditRecord(event({ action: "seed.run", meta } as Partial<AuditEvent>), "ok");
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("expected the record to be refused");
  };

  it.each([
    ["+14165550123"],
    ["jane@example.com"],
    ["jane"],
    ["Jane Doe"],
  ])("masks the record key %s in the path", (key) => {
    const message = messageOf({ seed: "buildings", counts: { [key]: "x" } });

    expect(message).toBe("seed.run: meta.counts.(key) is invalid");
    expect(message).not.toContain(key);
  });

  it("keeps schema keys and array indexes", () => {
    expect(messageOf({ seed: 5 })).toBe("seed.run: meta.seed is invalid");
    expect(() =>
      toAuditRecord(event({ action: "assignment.saved", meta: { floor_ids: [FLOOR, "x"] } } as Partial<AuditEvent>), "ok"),
    ).toThrow("assignment.saved: meta.floor_ids.1 is invalid");
  });
});

describe("findSensitiveValue", () => {
  it.each([
    ["4165550123", "meta"],
    ["(416) 555-0123", "meta"],
    ["+1 416 555 0123", "meta"],
    ["jane.doe@example.org", "meta"],
    [{ a: [1, "x", "jane@example.com"] }, "meta.a[2]"],
    [12345678901, "meta"],
    ["416/555/0199", "meta"],
    ["416_555_0199", "meta"],
    ["416:555:0199", "meta"],
  ])("finds %j", (value, path) => {
    expect(findSensitiveValue(value)).toBe(path);
  });

  it.each([
    ["SM00000000000000000000000000000000"],
    ["MM12345678901234567890123456789012"],
  ])("passes the Twilio message SID %s, as a whole value only", (sid) => {
    expect(findSensitiveValue(sid)).toBeNull();
    expect(findSensitiveValue(`${sid} `)).toBe("meta");
  });

  it.each([["4155426"], ["123e4567-e89b-12d3-a456-426614174000"], ["00000000-0000-4000-8000-000000000000"], [43], ["aal2"], [null]])(
    "passes %j",
    (value) => {
      expect(findSensitiveValue(value)).toBeNull();
    },
  );
});
