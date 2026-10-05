import { describe, expect, it, vi } from "vitest";
import type { SignupCheck } from "@/contracts/signup";
import type { Signup, SignupOutcome } from "@/modules/subscriptions";
import { bodyFromForm, signupFromForm, type ControlDeps } from "./control";

// Every number is fictional (555).
const STAFF = { staffId: "01900000-0000-7000-8000-0000000000a1" };
const FLOOR = "0190f000-0000-7000-8000-000000000002";

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const one of [value].flat()) data.append(name, one);
  return data;
};
const FULL = {
  phone: "۴۱۶ ۵۵۵ ۰۱۲۳",
  lang: "ur",
  consent_version: "2026-10-02.1",
  neighbourhood: "TP",
  building: "9100001",
  floor: FLOOR,
  groups: ["seniors", "families"],
  terms_agreed: "yes",
  age_confirmed: "yes",
};

function world(outcome: SignupOutcome | Error = { kind: "accepted" }) {
  const checks: { checked: SignupCheck; staffId: string }[] = [];
  const logged: { event: string; fields: Record<string, string> }[] = [];
  const signup: Signup = {
    request: vi.fn(),
    async assist(checked, staffId) {
      checks.push({ checked, staffId });
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  const afterAccepted = vi.fn();
  const deps: ControlDeps = { signup: () => signup, afterAccepted, logError: (event, fields) => void logged.push({ event, fields }) };
  return { deps, checks, logged, afterAccepted, signup };
}

describe("the form as the sign-up contract's body", () => {
  it("reads the number, language, terms version, neighbourhood, one building and floor, the groups and the two statements", () => {
    expect(bodyFromForm(form(FULL))).toEqual({
      v: 1,
      phone: "۴۱۶ ۵۵۵ ۰۱۲۳",
      lang: "ur",
      neighbourhood: "TP",
      places: [{ rsn: "9100001", floors: [FLOOR] }],
      groups: ["seniors", "families"],
      consent_version: "2026-10-02.1",
      terms_agreed: true,
      age_confirmed: true,
    });
  });

  it("leaves out what was not chosen: no building, no floor, no groups, no neighbourhood, statements not ticked", () => {
    expect(bodyFromForm(form({ phone: "416 555 0123", lang: "en", consent_version: "2026-10-02.1", building: "", floor: "" }))).toEqual({
      v: 1,
      phone: "416 555 0123",
      lang: "en",
      neighbourhood: null,
      places: [],
      groups: [],
      consent_version: "2026-10-02.1",
      terms_agreed: false,
      age_confirmed: false,
    });
    expect(bodyFromForm(form({ ...FULL, floor: "" }))).toMatchObject({ places: [{ rsn: "9100001", floors: [] }] });
  });

  it("is unreadable without the number, the language or the terms version, or with a file for a field", () => {
    for (const missing of ["phone", "lang", "consent_version"]) {
      const fields: Record<string, string | string[]> = { ...FULL };
      delete fields[missing];
      expect(bodyFromForm(form(fields)), missing).toBeNull();
    }
    const withFile = form(FULL);
    withFile.append("groups", new Blob(["x"]));
    expect(bodyFromForm(withFile)).toBeNull();
  });
});

describe("pressing 'Send the confirmation text'", () => {
  it("hands the contract's check (the number in E.164, read from Urdu digits) to the staff-assisted sign-up as the signed-in staff member, says it is started and starts the sender", async () => {
    const w = world();
    expect(await signupFromForm(w.deps, STAFF, form(FULL))).toEqual({ status: "done" });

    expect(w.checks).toEqual([
      {
        checked: { ok: true, value: { phone: "+14165550123", lang: "ur", neighbourhood: "TP", places: [{ rsn: "9100001", floors: [FLOOR] }], groups: ["seniors", "families"], consentVersion: "2026-10-02.1" } },
        staffId: STAFF.staffId,
      },
    ]);
    expect(w.afterAccepted).toHaveBeenCalledTimes(1);
    expect(w.signup.request).not.toHaveBeenCalled();
  });

  it("hands a refusal of the contract on too (so it is audited), and says what to fix and that nothing was sent", async () => {
    const w = world({ kind: "refused", code: "terms_not_agreed" });
    const answer = await signupFromForm(w.deps, STAFF, form({ ...FULL, terms_agreed: "" }));

    expect(w.checks[0]!.checked).toEqual({ ok: false, code: "terms_not_agreed" });
    expect(answer).toEqual({ status: "refused", message: "Confirm that the resident heard the terms and agrees to them. Nothing was sent." });
    expect(w.afterAccepted).not.toHaveBeenCalled();
  });

  it("says when the staff account has started its 40 sign-ups", async () => {
    const w = world({ kind: "rate_limited", retryAfterSeconds: 600 });
    expect(await signupFromForm(w.deps, STAFF, form(FULL))).toEqual({
      status: "refused",
      message: "You have started 40 sign-ups in the last 24 hours, the most one staff account can. Ask another staff member to continue. Nothing was sent.",
    });
  });

  it("logs a failure by the error's name only, never the number, and says nothing was sent", async () => {
    const w = world(new TypeError("+14165550123 could not be written"));
    expect(await signupFromForm(w.deps, STAFF, form(FULL))).toEqual({ status: "refused", message: "The sign-up was not started. Try again. If it fails again, tell IT. Nothing was sent." });
    expect(w.logged).toEqual([{ event: "signup.assisted_failed", fields: { error: "TypeError" } }]);
    expect(JSON.stringify(w.logged)).not.toContain("555");
  });

  it("never puts the number in an answer (the example in a refusal is not the number typed)", async () => {
    for (const outcome of [{ kind: "accepted" }, { kind: "refused", code: "phone_not_canadian" }] as SignupOutcome[]) {
      expect(JSON.stringify(await signupFromForm(world(outcome).deps, STAFF, form(FULL)))).not.toMatch(/5550123|۵۵۵/);
    }
  });
});
