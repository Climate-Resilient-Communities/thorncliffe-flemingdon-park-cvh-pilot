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
    ["factor.reset", { recovery: "lost_device" }],
    ["factor.reset", { recovery: "all_admins_lost_access", attested: true, admin_shortfall: true }],
    ["factor.reset", { recovery: "device_broken" }],
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

  it("carries admin_shortfall only as true, on the recovery actions and automatic locks (S01.06)", () => {
    for (const [action, meta] of [
      ["password.reset", {}],
      ["password.reissued", {}],
      ["factor.reset", { recovery: "lost_device" }],
      ["auth.locked", { lock: "failed_sign_in" }],
    ] as const) {
      expect(toAuditRecord(event({ action, meta: { ...meta, admin_shortfall: true } } as Partial<AuditEvent>), "ok").meta, action).toMatchObject({
        admin_shortfall: true,
      });
      expect(() => toAuditRecord(event({ action, meta: { ...meta, admin_shortfall: false } } as unknown as Partial<AuditEvent>), "ok"), action).toThrow(
        AuditRecordError,
      );
    }
    for (const action of ["account.suspended", "account.removed", "account.role_changed"] as const) {
      expect(() => toAuditRecord(event({ action, meta: { admin_shortfall: true } } as Partial<AuditEvent>), "ok"), action).toThrow(
        /fields outside the schema: admin_shortfall/,
      );
    }
  });

  it("keeps the authenticator reset's reason to a fixed list, never free text (S01.11)", () => {
    for (const recovery of ["lost my phone on the bus", "other", ""]) {
      expect(() => toAuditRecord(event({ action: "factor.reset", meta: { recovery } } as unknown as Partial<AuditEvent>), "ok"), recovery).toThrow(AuditRecordError);
    }
    expect(() => toAuditRecord(event({ action: "factor.reset", meta: { reason_text: "lost it" } } as unknown as Partial<AuditEvent>), "ok")).toThrow(/fields outside the schema/);
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

  describe("provider actions (S02.04)", () => {
    const provider = (overrides: Partial<AuditEvent>) =>
      event({ action: "provider.confirmed", subjectType: "provider", subjectId: "M001", meta: { confirmed_on: "2026-10-01", previous: null }, ...overrides } as Partial<AuditEvent>);

    it("accepts the catalogue id of a provider as the subject, with the date it was confirmed", () => {
      expect(toAuditRecord(provider({}), "ok")).toMatchObject({ action: "provider.confirmed", subjectType: "provider", subjectId: "M001", meta: { confirmed_on: "2026-10-01", previous: null } });
      expect(toAuditRecord(provider({ action: "provider.published", meta: { last_confirmed: "2026-10-01" } } as Partial<AuditEvent>), "ok").meta).toEqual({ last_confirmed: "2026-10-01" });
      expect(toAuditRecord(provider({ action: "provider.unpublished", meta: {} } as Partial<AuditEvent>), "ok").meta).toEqual({});
    });

    it("records a refusal with its reason and no other detail", () => {
      expect(toAuditRecord(provider({ action: "provider.published", meta: { reason: "validation" } } as Partial<AuditEvent>), "refused").meta).toEqual({ reason: "validation" });
    });

    it.each([
      ["listing text", "provider.confirmed", { confirmed_on: "2026-10-01", services: "Free food bank" }],
      ["a name", "provider.published", { name: "Thorncliffe Neighbourhood Office" }],
      ["a phone number", "provider.unpublished", { phone: "416-421-3050" }],
      ["a date that is not a date", "provider.confirmed", { confirmed_on: "yesterday" }],
      ["a day that does not exist", "provider.confirmed", { confirmed_on: "2026-02-31" }],
      ["a previous date that does not exist", "provider.confirmed", { confirmed_on: "2026-10-01", previous: "2026-13-01" }],
      ["a last-confirmed date that does not exist", "provider.published", { last_confirmed: "2026-02-31" }],
    ])("rejects %s", (_, action, meta) => {
      expect(() => toAuditRecord(provider({ action, meta } as Partial<AuditEvent>), "ok")).toThrow(AuditRecordError);
    });

    it.each([
      ["a confirmation with no confirmed_on", "provider.confirmed", { previous: null }],
      ["a confirmation with an empty meta", "provider.confirmed", {}],
      ["a publication with no last_confirmed", "provider.published", {}],
    ])("rejects an ok record of %s", (_, action, meta) => {
      expect(() => toAuditRecord(provider({ action, meta } as Partial<AuditEvent>), "ok")).toThrow(/meta is missing (confirmed_on|last_confirmed)/);
    });

    it("accepts the same events as refusals: a refusal carries only its reason", () => {
      expect(toAuditRecord(provider({ action: "provider.confirmed", meta: { reason: "validation" } } as Partial<AuditEvent>), "refused").meta).toEqual({ reason: "validation" });
      expect(toAuditRecord(provider({ action: "provider.published", meta: { reason: "validation" } } as Partial<AuditEvent>), "refused").meta).toEqual({ reason: "validation" });
    });

    it("accepts a leap day and refuses one in a year that has none", () => {
      expect(() => toAuditRecord(provider({ meta: { confirmed_on: "2028-02-29", previous: null } } as Partial<AuditEvent>), "ok")).not.toThrow();
      expect(() => toAuditRecord(provider({ meta: { confirmed_on: "2026-02-29", previous: null } } as Partial<AuditEvent>), "ok")).toThrow(AuditRecordError);
    });
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

  it("accepts a catalogue id as the subject of a provider, and only of a provider", () => {
    expect(() => toAuditRecord(event({ action: "provider.unpublished", subjectType: "provider", subjectId: "M001", meta: {} }), "ok")).not.toThrow();
    expect(() => toAuditRecord(event({ action: "provider.unpublished", subjectType: "provider", subjectId: "B1205", meta: {} }), "ok")).not.toThrow();
  });

  it.each([
    ["a staff account", "account.suspended", "staff_account"],
    ["a building", "building.confirmed", "building"],
    ["a seed", "seed.run", "guides_and_numbers"],
  ])("refuses a catalogue id such as B1205 as the subject of %s", (_, action, subjectType) => {
    const meta = action === "seed.run" ? { seed: "buildings" } : {};
    expect(() => toAuditRecord(event({ action, subjectType, subjectId: "B1205", meta } as Partial<AuditEvent>), "ok")).toThrow(AuditRecordError);
    expect(() => toAuditRecord(event({ action, subjectType, subjectId: "M001", meta } as Partial<AuditEvent>), "refused")).toThrow(AuditRecordError);
  });

  it("refuses a provider subject that is not a catalogue id", () => {
    for (const subjectId of ["M-001", "M4165550199", "M12", "MM001"]) {
      expect(() => toAuditRecord(event({ action: "provider.unpublished", subjectType: "provider", subjectId, meta: {} }), "ok"), subjectId).toThrow(AuditRecordError);
    }
  });

  it.each([
    ["colons", "416:555:0199"],
    ["underscores between digits", "416_555_0199"],
    ["a username with a dot", "jane.doe"],
    ["a kebab-case username", "rvh-jane-doe"],
    ["a ten digit number", "4165550199"],
    ["a SID of the wrong length", "SM0123"],
    ["an upper case SID", "SM0123456789ABCDEF0123456789ABCDEF"],
    ["a capital letter and ten digits", "M4165550199"],
    ["a catalogue id with a hyphen", "M-001"],
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
    ["letters with no @", "a".repeat(50_000)],
    ["@ signs with no dot", "a@".repeat(25_000)],
    ["dots and @ signs", "a@b.".repeat(12_500) + " "],
    ["digits that are not a phone number", "1 ".repeat(9) + "x".repeat(50_000)],
    ["spaces", " ".repeat(50_000)],
    ["a local part that never ends", `${"a".repeat(50_000)}@`],
  ])("scans 50,000 characters of %s in under 100 ms", (_name, value) => {
    const start = performance.now();
    findSensitiveValue(value);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it.each([
    ["a@b.c", true],
    ["see jane.doe@example.org now", true],
    ["x@y@z.com", true],
    ["@b.cc", false],
    ["a@.c", false],
    ["a@b.", false],
    ["a@bc", false],
    ["a @ b.c", false],
    ["user@@host.org", false],
  ])("finds an email address in %j: %s", (value, found) => {
    expect(findSensitiveValue(value)).toBe(found ? "meta" : null);
  });

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

describe("alert lifecycle actions (S04.03)", () => {
  const ENTRY = "5a1e0c9d-2b7f-4e83-9c14-6d0f8a3b2e71";
  const HASH_WITH_LONG_DIGIT_RUN = `${"1234567890".repeat(6)}abcd`;
  const alertEvent = (action: string, meta: Record<string, unknown>, subjectType = "alert_entry") =>
    event({ action, subjectType, subjectId: ENTRY, meta } as unknown as Partial<AuditEvent>);

  it.each([
    ["alert.created", { entry_id: ENTRY, kind: "ack", types: ["power", "water"] }, "alert"],
    ["entry.submitted", { entry_id: ENTRY, version: 1, content_hash: HASH_WITH_LONG_DIGIT_RUN }, "alert_entry"],
    ["entry.returned", { entry_id: ENTRY, version: 1, returned_for: "retranslate" }, "alert_entry"],
    ["entry.discarded", { entry_id: ENTRY, version: 0, from: "draft" }, "alert_entry"],
    ["entry.approved", { entry_id: ENTRY, version: 2, content_hash: "a".repeat(64) }, "alert_entry"],
  ])("accepts %s with its strict meta, a content hash included", (action, meta, subjectType) => {
    expect(toAuditRecord(alertEvent(action, meta, subjectType), "ok").meta).toEqual(meta);
  });

  it("accepts a refusal with only its reason, including alert_closed", () => {
    expect(toAuditRecord(alertEvent("entry.approved", { reason: "alert_closed" }), "refused")).toMatchObject({ outcome: "refused", meta: { reason: "alert_closed" } });
    expect(toAuditRecord(alertEvent("entry.approved", { reason: "self_action" }), "refused").meta).toEqual({ reason: "self_action" });
  });

  it.each([
    ["alert.created", { kind: "ack" }],
    ["entry.submitted", { entry_id: ENTRY, version: 1 }],
    ["entry.returned", { entry_id: ENTRY, version: 1 }],
    ["entry.discarded", { version: 1, from: "draft" }],
    ["entry.approved", { entry_id: ENTRY, content_hash: "a".repeat(64) }],
  ])("requires the entry id and frozen facts on an ok %s: %j", (action, meta) => {
    expect(() => toAuditRecord(alertEvent(action, meta), "ok")).toThrow(/meta is missing/);
  });

  it.each([
    ["the text", "entry.submitted", { entry_id: ENTRY, version: 1, content_hash: "a".repeat(64), text: "Power is out" }],
    ["a note", "entry.returned", { entry_id: ENTRY, version: 1, returned_for: "return", note: "fix the floor" }],
    ["a person's id other than the actor", "entry.approved", { entry_id: ENTRY, version: 1, content_hash: "a".repeat(64), approver_id: ENTRY }],
    ["a hash that is not a SHA-256", "entry.approved", { entry_id: ENTRY, version: 1, content_hash: "abc" }],
    ["a return reason outside the list", "entry.returned", { entry_id: ENTRY, version: 1, returned_for: "because" }],
    ["a discard from a status that cannot be discarded", "entry.discarded", { entry_id: ENTRY, from: "approved" }],
    ["a kind outside the list", "alert.created", { entry_id: ENTRY, kind: "rumour" }],
  ])("rejects %s", (_, action, meta) => {
    expect(() => toAuditRecord(alertEvent(action, meta), "ok")).toThrow(AuditRecordError);
  });

  it("passes a SHA-256 as a whole value even when it holds a long run of digits", () => {
    expect(findSensitiveValue(HASH_WITH_LONG_DIGIT_RUN)).toBeNull();
    expect(findSensitiveValue(`${HASH_WITH_LONG_DIGIT_RUN} `)).toBe("meta");
  });
});
