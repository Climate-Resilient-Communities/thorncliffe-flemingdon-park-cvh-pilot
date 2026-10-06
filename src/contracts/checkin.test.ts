import { describe, expect, it } from "vitest";
import { CHECKIN_CONSENT_VERSION, CheckinRequestSchema, checkinRequestInput, isSavedPlace } from "./checkin";
import { SIGNUP_ACCEPTED, SignupAcceptedSchema, checkSignupRequest } from "./signup";
import { EditDoneBodySchema, checkEditChangeRequest } from "./subscriptionEdit";
import { USAGE_EVENTS } from "./usage";

const F1 = "0190F000-0000-7000-8000-000000000001";
const f1 = F1.toLowerCase();
const signup = (checkin: unknown) => ({
  v: 1,
  phone: "416 555 0123",
  lang: "en",
  neighbourhood: "TP",
  places: [{ rsn: "100", floors: [F1] }, { rsn: "200", floors: [] }],
  groups: [],
  consent_version: "2026-10-02.1",
  terms_agreed: true,
  age_confirmed: true,
  checkin,
});
const TOKEN = "a".repeat(43);
const change = (checkin: unknown) => ({ v: 1, token: TOKEN, lang: "en", neighbourhood: "TP", places: [{ rsn: "100", floors: [F1] }], groups: [], muted_topics: [], checkin });

describe("a check-in request on the wire (S08.05)", () => {
  it("names a building, a floor, call or text, and the consent version or none", () => {
    expect(CheckinRequestSchema.safeParse({ rsn: "100", floor: F1, method: "call", consent_version: CHECKIN_CONSENT_VERSION }).success).toBe(true);
    expect(CheckinRequestSchema.safeParse({ rsn: "100", floor: F1, method: "knock", consent_version: null }).success).toBe(false);
    expect(CheckinRequestSchema.safeParse({ rsn: "100", floor: F1, method: "call", consent_version: null, phone: "x" }).success).toBe(false);
    expect(checkinRequestInput({ rsn: "100", floor: F1, method: "text", consent_version: null })).toEqual({ rsn: "100", floorId: f1, method: "text", consentVersion: null });
    expect(isSavedPlace({ rsn: "100", floorId: f1 }, [{ rsn: "100", floors: [f1] }])).toBe(true);
    expect(isSavedPlace({ rsn: "200", floorId: f1 }, [{ rsn: "200", floors: [] }])).toBe(false);
  });

  it("on the sign-up: on one of its places with that floor, with the consent shown now; none is the sign-up of S07.02", () => {
    const ok = checkSignupRequest(signup({ rsn: "100", floor: F1, method: "call", consent_version: CHECKIN_CONSENT_VERSION }));
    expect(ok).toMatchObject({ ok: true, value: { checkin: { rsn: "100", floorId: f1, method: "call", consentVersion: CHECKIN_CONSENT_VERSION } } });
    expect(checkSignupRequest(signup(undefined))).toMatchObject({ ok: true });
    expect((checkSignupRequest(signup(undefined)) as { value: object }).value).not.toHaveProperty("checkin");
    expect(checkSignupRequest(signup({ rsn: "100", floor: F1, method: "call", consent_version: null }))).toEqual({ ok: false, code: "checkin_consent_missing" });
    expect(checkSignupRequest(signup({ rsn: "100", floor: F1, method: "call", consent_version: "2020-01-01.1" }))).toEqual({ ok: false, code: "invalid_request" });
    // Not one of the places, or a building saved without that floor.
    expect(checkSignupRequest(signup({ rsn: "300", floor: F1, method: "call", consent_version: CHECKIN_CONSENT_VERSION }))).toEqual({ ok: false, code: "invalid_request" });
    expect(checkSignupRequest(signup({ rsn: "200", floor: F1, method: "call", consent_version: CHECKIN_CONSENT_VERSION }))).toEqual({ ok: false, code: "invalid_request" });
  });

  it("on the edit page: one on its places (the consent, if given, the one shown now), none to withdraw, or left out to keep it", () => {
    expect(checkEditChangeRequest(change({ rsn: "100", floor: F1, method: "text", consent_version: null }))).toMatchObject({ ok: true, value: { checkin: { floorId: f1, consentVersion: null } } });
    expect(checkEditChangeRequest(change(null))).toMatchObject({ ok: true, value: { checkin: null } });
    const without: Record<string, unknown> = change(undefined);
    delete without.checkin;
    expect((checkEditChangeRequest(without) as { value: object }).value).not.toHaveProperty("checkin");
    expect(checkEditChangeRequest(change({ rsn: "200", floor: F1, method: "text", consent_version: null }))).toEqual({ ok: false, code: "invalid_request" });
    expect(checkEditChangeRequest(change({ rsn: "100", floor: F1, method: "text", consent_version: "2020-01-01.1" }))).toEqual({ ok: false, code: "invalid_request" });
  });

  it("answers what became of it in the forms' own answers, never anywhere else (no usage event carries it)", () => {
    expect(SignupAcceptedSchema.parse({ ...SIGNUP_ACCEPTED, checkin: "uncovered" })).toEqual({ v: 1, status: "accepted", checkin: "uncovered" });
    expect(SignupAcceptedSchema.safeParse({ ...SIGNUP_ACCEPTED, checkin: "withdrawn" }).success).toBe(false);
    expect(EditDoneBodySchema.parse({ v: 1, status: "changed", checkin: "method_changed" })).toMatchObject({ checkin: "method_changed" });
    // Usage events are a fixed list of what is used (S02.15): none is about a check-in.
    expect(USAGE_EVENTS.some((event) => /check/i.test(event))).toBe(false);
  });
});
