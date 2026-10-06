import { describe, expect, it } from "vitest";
import {
  ALERT_RECIPIENT_KINDS,
  BODY_MAX_CHARS,
  CAMPAIGN_RECIPIENT_KINDS,
  CREATING_MODULES,
  RECIPIENT_KINDS,
  RECIPIENT_OWNER,
  SEGMENTS_MAX,
  TRANSACTIONAL_PURPOSES,
  alertKey,
  alertRecipientRefusal,
  campaignRefusal,
  contentRefusal,
  isConsumedAtHandOff,
  isUuid,
  outboundKey,
  purposeRule,
  transactionalRefusal,
} from "./deliveryRules";

const ID = "01900000-0000-7000-8000-0000000a0001";
const OTHER = "01900000-0000-7000-8000-0000000a0002";
const NOW = new Date("2026-10-03T15:00:00Z");
const MIN = 60_000;

describe("the allow-list of transactional purposes", () => {
  it("names, per module, the purposes of the definitions", () => {
    const byModule = (module: string) => TRANSACTIONAL_PURPOSES.filter((p) => p.module === module).map((p) => p.purpose);
    expect(byModule("alerting")).toEqual(["approver_notice"]);
    expect(byModule("subscriptions")).toEqual(["confirmation", "welcome", "menu_reply", "prompt_reply", "edit_link", "signup_info", "reconsent_kept"]);
    expect(byModule("checkins")).toEqual(["escalation"]);
    expect(byModule("ops")).toEqual(["oncall_alert"]);
    for (const { module } of TRANSACTIONAL_PURPOSES) expect(CREATING_MODULES).toContain(module);
  });

  it("texts a confirmation to a pending sign-up only, and signup_info to an inbound_reply recipient only", () => {
    expect(purposeRule("subscriptions", "confirmation")?.recipientKinds).toEqual(["pending_signup"]);
    expect(purposeRule("subscriptions", "signup_info")?.recipientKinds).toEqual(["inbound_reply"]);
    expect(purposeRule("subscriptions", "welcome")?.recipientKinds).toEqual(["subscriber"]);
    expect(purposeRule("ops", "oncall_alert")?.recipientKinds).toEqual(["oncall"]);
    expect(purposeRule("alerting", "approver_notice")?.recipientKinds).toEqual(["staff"]);
  });

  it("gives each purpose a window: 30 minutes for a menu reply, 48 hours for a confirmation, 30 minutes for signup_info", () => {
    expect(purposeRule("subscriptions", "menu_reply")?.windowMs).toBe(30 * MIN);
    expect(purposeRule("subscriptions", "confirmation")?.windowMs).toBe(48 * 60 * MIN);
    expect(purposeRule("subscriptions", "signup_info")?.windowMs).toBe(30 * MIN);
    for (const { windowMs } of TRANSACTIONAL_PURPOSES) expect(windowMs).toBeGreaterThan(0);
  });

  it("knows a purpose only for the module that owns it", () => {
    for (const rule of TRANSACTIONAL_PURPOSES) {
      for (const owner of CREATING_MODULES) expect(purposeRule(owner, rule.purpose) !== undefined, `${owner}/${rule.purpose}`).toBe(owner === rule.module);
    }
    expect(purposeRule("subscriptions", "oncall_alert")).toBeUndefined();
    expect(purposeRule("ops", "welcome")).toBeUndefined();
    expect(purposeRule("ops", "nothing")).toBeUndefined();
    expect(purposeRule("directory", "menu_reply")).toBeUndefined();
  });

  it("refuses a transactional text for a purpose of another module, a recipient the purpose never texts, or a bad send_by", () => {
    const ok = { module: "subscriptions", purpose: "menu_reply", recipient: { kind: "subscriber", id: ID }, now: NOW };
    expect(transactionalRefusal(ok)).toBeNull();
    expect(transactionalRefusal({ ...ok, module: "ops" })).toBe("PURPOSE_NOT_ALLOWED");
    expect(transactionalRefusal({ ...ok, purpose: "unknown" })).toBe("PURPOSE_NOT_ALLOWED");
    expect(transactionalRefusal({ ...ok, recipient: { kind: "oncall", id: ID } })).toBe("RECIPIENT_NOT_ALLOWED");
    expect(transactionalRefusal({ ...ok, recipient: { kind: "subscriber", id: "x" } })).toBe("ID_INVALID");
    expect(transactionalRefusal({ ...ok, sendBy: new Date(NOW.getTime() + 20 * MIN) })).toBeNull();
    expect(transactionalRefusal({ ...ok, sendBy: new Date(NOW.getTime() + 30 * MIN) })).toBeNull();
    expect(transactionalRefusal({ ...ok, sendBy: new Date(NOW.getTime() + 30 * MIN + 1) })).toBe("SEND_BY_INVALID");
    expect(transactionalRefusal({ ...ok, sendBy: NOW })).toBe("SEND_BY_INVALID");
    expect(transactionalRefusal({ ...ok, sendBy: new Date(Number.NaN) })).toBe("SEND_BY_INVALID");
    // signup_info is due when its inbound_reply row expires, so the caller must say when.
    const info = { module: "subscriptions", purpose: "signup_info", recipient: { kind: "inbound_reply", id: ID }, now: NOW };
    expect(transactionalRefusal(info)).toBe("SEND_BY_INVALID");
    expect(transactionalRefusal({ ...info, sendBy: new Date(NOW.getTime() + 10 * MIN) })).toBeNull();
  });
});

describe("the kinds of recipient", () => {
  it("are the six of the definitions, each owned by the module whose table holds it", () => {
    expect([...RECIPIENT_KINDS].sort()).toEqual(["inbound_reply", "oncall", "pending_signup", "roster", "staff", "subscriber"]);
    expect(RECIPIENT_OWNER).toEqual({ subscriber: "subscriptions", pending_signup: "subscriptions", roster: "subscriptions", inbound_reply: "subscriptions", staff: "identity", oncall: "ops" });
  });

  it("take the number at the hand-off point only for an inbound_reply recipient", () => {
    for (const kind of RECIPIENT_KINDS) expect(isConsumedAtHandOff(kind), kind).toBe(kind === "inbound_reply");
  });

  it("let an alert go to a subscriber or a roster member only", () => {
    expect(ALERT_RECIPIENT_KINDS).toEqual(["subscriber", "roster"]);
    for (const kind of RECIPIENT_KINDS) expect(alertRecipientRefusal({ kind, id: ID }), kind).toBe(kind === "subscriber" || kind === "roster" ? null : "RECIPIENT_NOT_ALLOWED");
    expect(alertRecipientRefusal({ kind: "subscriber", id: "nope" })).toBe("ID_INVALID");
  });
});

describe("idempotency keys", () => {
  it("make an alert's key entry:recipient:channel", () => {
    expect(alertKey(ID, OTHER)).toBe(`${ID}:${OTHER}:sms`);
    expect(alertKey(ID, OTHER, "sms")).toBe(alertKey(ID, OTHER));
  });

  it("make any other key kind:subject:purpose:nonce, and refuse a part that is a phone number, has a colon or is empty", () => {
    expect(outboundKey({ kind: "transactional", subject: ID, purpose: "welcome", nonce: "n1" })).toBe(`transactional:${ID}:welcome:n1`);
    expect(outboundKey({ kind: "campaign", subject: ID, purpose: "reconsent", nonce: OTHER })).toBe(`campaign:${ID}:reconsent:${OTHER}`);
    const bad = [
      { subject: "+14165550101", nonce: "n" },
      { subject: "4165550101", nonce: "n" },
      { subject: "a:b", nonce: "n" },
      { subject: "", nonce: "n" },
      { subject: "s", nonce: "" },
      { subject: "s", nonce: "(416) 555-0101" },
      { subject: "x".repeat(65), nonce: "n" },
    ];
    for (const parts of bad) expect(outboundKey({ kind: "transactional", purpose: "welcome", ...parts }), JSON.stringify(parts)).toBeNull();
    expect(outboundKey({ kind: "transactional", subject: "s", purpose: "Welcome Back", nonce: "n" })).toBeNull();
  });
});

describe("what a delivery freezes", () => {
  const ok = { lang: "ur", body: "text", segments: 2, costEstimateCents: 4 };

  it("is a launch language, a body that is not empty or longer than Twilio's 1600 characters, segments from 1 to 24 and a whole cost", () => {
    expect(contentRefusal(ok)).toBeNull();
    expect(contentRefusal({ ...ok, lang: "zh-Hant" })).toBeNull();
    expect(contentRefusal({ ...ok, lang: "xx" })).toBe("LANG_INVALID");
    expect(contentRefusal({ ...ok, body: "  " })).toBe("BODY_INVALID");
    expect(contentRefusal({ ...ok, body: "a".repeat(BODY_MAX_CHARS) })).toBeNull();
    expect(contentRefusal({ ...ok, body: "a".repeat(BODY_MAX_CHARS + 1) })).toBe("BODY_INVALID");
    expect(contentRefusal({ ...ok, segments: 0 })).toBe("SEGMENTS_INVALID");
    expect(contentRefusal({ ...ok, segments: SEGMENTS_MAX })).toBeNull();
    expect(contentRefusal({ ...ok, segments: SEGMENTS_MAX + 1 })).toBe("SEGMENTS_INVALID");
    expect(contentRefusal({ ...ok, segments: 1.5 })).toBe("SEGMENTS_INVALID");
    expect(contentRefusal({ ...ok, costEstimateCents: -1 })).toBe("COST_INVALID");
    expect(contentRefusal({ ...ok, costEstimateCents: 0.5 })).toBe("COST_INVALID");
    expect(contentRefusal({ ...ok, costEstimateCents: 0 })).toBeNull();
  });

  it("counts characters, not UTF-16 units, so a long body in a non-Latin script is judged as the database judges it", () => {
    expect(contentRefusal({ ...ok, body: "😀".repeat(BODY_MAX_CHARS) })).toBeNull();
  });
});

describe("a campaign delivery", () => {
  it("needs a purpose code and ids", () => {
    const ok = { purpose: "reconsent", recipient: { kind: "subscriber", id: ID }, campaignId: OTHER };
    expect(campaignRefusal(ok)).toBeNull();
    expect(campaignRefusal({ ...ok, purpose: "Re Consent" })).toBe("CAMPAIGN_PURPOSE_INVALID");
    expect(campaignRefusal({ ...ok, campaignId: "x" })).toBe("ID_INVALID");
    expect(campaignRefusal({ ...ok, recipient: { kind: "subscriber", id: "x" } })).toBe("ID_INVALID");
    expect(campaignRefusal({ ...ok, recipient: { kind: "stranger", id: ID } })).toBe("RECIPIENT_NOT_ALLOWED");
  });

  it("goes to a subscriber, or to a drill-roster member for a rehearsal (S09.07), and to no other kind of recipient (the table's check)", () => {
    expect(CAMPAIGN_RECIPIENT_KINDS).toEqual(["subscriber", "roster"]);
    const ok = { purpose: "reconsent", recipient: { kind: "subscriber", id: ID }, campaignId: OTHER };
    for (const kind of RECIPIENT_KINDS) {
      expect(campaignRefusal({ ...ok, recipient: { kind, id: ID } }), kind).toBe(kind === "subscriber" || kind === "roster" ? null : "RECIPIENT_NOT_ALLOWED");
    }
  });
});

describe("ids", () => {
  it("are lowercase UUIDs: the database compares them as lowercase text, so an uppercase one is a refusal here, not an error there", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(false);
    expect(isUuid(`${ID} `)).toBe(false);
    expect(isUuid("x")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(alertRecipientRefusal({ kind: "subscriber", id: ID.toUpperCase() })).toBe("ID_INVALID");
    expect(transactionalRefusal({ module: "subscriptions", purpose: "welcome", recipient: { kind: "subscriber", id: ID.toUpperCase() }, now: NOW })).toBe("ID_INVALID");
    expect(campaignRefusal({ purpose: "reconsent", recipient: { kind: "subscriber", id: ID }, campaignId: OTHER.toUpperCase() })).toBe("ID_INVALID");
  });
});
