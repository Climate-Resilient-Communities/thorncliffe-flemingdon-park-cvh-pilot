import { describe, expect, it, vi } from "vitest";
import type { Signup, SignupOutcome } from "@/modules/subscriptions";
import { ACCEPTED_BODY, signupResponse } from "./handler";

// The route's answers with the use case faked (the byte-for-byte comparison of the three accepted cases against a real database is in
// test/db/signup.db.test.ts). Every number is fictional (555).

const BODY = {
  v: 1,
  phone: "416 555 0123",
  lang: "en",
  neighbourhood: "TP",
  places: [],
  groups: [],
  consent_version: "2026-10-02.1",
  terms_agreed: true,
  age_confirmed: true,
};

function post(body: unknown): Request {
  return new Request("https://cvh.example/api/signup", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "x-real-ip": "203.0.113.7" } });
}

function deps(outcome: SignupOutcome | Error) {
  const calls: { phone: string; client: string }[] = [];
  const signup: Signup = {
    async request(input, client) {
      calls.push({ phone: input.phone, client });
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    async assist() {
      throw new Error("the web route never starts a staff-assisted sign-up");
    },
  };
  const afterAccepted = vi.fn();
  return { calls, afterAccepted, deps: { signup: () => signup, client: (headers: Headers) => headers.get("x-real-ip") ?? "unknown", afterAccepted } };
}

const headersOf = (response: Response) => Object.fromEntries([...response.headers.entries()].sort());

describe("POST /api/signup", () => {
  it("answers an accepted sign-up with 202 and the one body, never cacheable, no cookie, and starts the sender", async () => {
    const fake = deps({ kind: "accepted" });
    const response = await signupResponse(fake.deps, post(BODY));

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('{"v":1,"status":"accepted"}');
    expect(ACCEPTED_BODY).toBe('{"v":1,"status":"accepted"}');
    expect(headersOf(response)).toEqual({ "cache-control": "no-store", "content-type": "application/json" });
    expect(fake.calls).toEqual([{ phone: "+14165550123", client: "203.0.113.7" }]);
    expect(fake.afterAccepted).toHaveBeenCalledTimes(1);
  });

  it("S08.05: says whether a check-in request's floor is covered in the same no-store answer (the personalised check-in response rule)", async () => {
    for (const checkin of ["requested", "uncovered"] as const) {
      const fake = deps({ kind: "accepted", checkin });
      const response = await signupResponse(fake.deps, post(BODY));
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ v: 1, status: "accepted", checkin });
      expect(headersOf(response)).toEqual({ "cache-control": "no-store", "content-type": "application/json" });
    }
  });

  it("reads a number typed in Urdu or full-width digits as the same E.164 number", async () => {
    for (const phone of ["۴۱۶ ۵۵۵ ۰۱۲۳", "４１６ ５５５ ０１２３"]) {
      const fake = deps({ kind: "accepted" });
      const response = await signupResponse(fake.deps, post({ ...BODY, phone }));
      expect(response.status, phone).toBe(202);
      expect(fake.calls, phone).toEqual([{ phone: "+14165550123", client: "203.0.113.7" }]);
    }
  });

  it("refuses with the reason, in the failure body, without calling the use case, for what the form can get wrong", async () => {
    const cases: [unknown, string][] = [
      [{ ...BODY, phone: "212 555 0123" }, "phone_not_canadian"],
      [{ ...BODY, neighbourhood: null }, "neighbourhood_missing"],
      [{ ...BODY, terms_agreed: false }, "terms_not_agreed"],
      [{ ...BODY, age_confirmed: false }, "age_not_confirmed"],
      ["not json", "invalid_request"],
      [{ ...BODY, v: 9 }, "invalid_request"],
      [`{"phone":"${"1".repeat(40_000)}"}`, "invalid_request"],
    ];
    for (const [body, code] of cases) {
      const fake = deps({ kind: "accepted" });
      const response = await signupResponse(fake.deps, post(body));

      expect(response.status, code).toBe(400);
      expect(await response.json(), code).toEqual({ error: { code, message_key: `signup.error.${code}` } });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(fake.calls).toEqual([]);
      expect(fake.afterAccepted).not.toHaveBeenCalled();
    }
  });

  it("passes on the use case's refusals with their statuses, and the limit with a Retry-After", async () => {
    const expectations: [SignupOutcome, number, string][] = [
      [{ kind: "refused", code: "terms_changed" }, 409, "terms_changed"],
      [{ kind: "refused", code: "place_unknown" }, 400, "place_unknown"],
      [{ kind: "refused", code: "signup_unavailable" }, 503, "signup_unavailable"],
      [{ kind: "rate_limited", retryAfterSeconds: 1200 }, 429, "rate_limited"],
    ];
    for (const [outcome, status, code] of expectations) {
      const fake = deps(outcome);
      const response = await signupResponse(fake.deps, post(BODY));

      expect(response.status, code).toBe(status);
      expect((await response.json()).error.code).toBe(code);
      expect(fake.afterAccepted).not.toHaveBeenCalled();
      if (code === "rate_limited") expect(response.headers.get("retry-after")).toBe("1200");
    }
  });

  it("answers 503 when the sign-up cannot be made, logging a safe classification and never the number", async () => {
    const error = Object.assign(new Error("connect ECONNREFUSED +14165550123"), { code: "ECONNREFUSED" });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await signupResponse(deps(error).deps, post(BODY));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("signup_unavailable");
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/555/);
    log.mockRestore();
  });
});
