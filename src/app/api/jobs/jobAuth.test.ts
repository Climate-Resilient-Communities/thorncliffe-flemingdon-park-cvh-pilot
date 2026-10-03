import { describe, expect, it } from "vitest";
import { checkJobSecret } from "./jobAuth";

const CURRENT = "9d1f6b3a8c2e4075a1b9c0d3e6f2a8b45c7d9e0f1a3b5c7d2e4f6a8b0c1d3e5f";
const PREVIOUS = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809";

const request = (authorization?: string) => new Request("https://cvh.example/api/jobs/dispatch", { method: "POST", headers: authorization === undefined ? {} : { authorization } });
const codeOf = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

describe("the job secret", () => {
  it("lets a request through that carries the current secret as a bearer token", () => {
    expect(checkJobSecret(request(`Bearer ${CURRENT}`), { jobSecrets: [CURRENT] })).toBeNull();
  });

  it("accepts the previous secret too, while a rotation is under way", () => {
    const env = { jobSecrets: [CURRENT, PREVIOUS] };
    expect(checkJobSecret(request(`Bearer ${CURRENT}`), env)).toBeNull();
    expect(checkJobSecret(request(`Bearer ${PREVIOUS}`), env)).toBeNull();
  });

  it("refuses a request with no secret, a wrong one, or one that is not a bearer token, with 401 and no detail", async () => {
    const env = { jobSecrets: [CURRENT] };
    for (const header of [undefined, "", "Bearer", "Bearer ", `Bearer ${PREVIOUS}`, `Bearer ${CURRENT}x`, `Bearer ${CURRENT.slice(1)}`, `Basic ${CURRENT}`, CURRENT, `bearer ${CURRENT}`, `Bearer ${CURRENT} extra`]) {
      const denied = checkJobSecret(request(header), env);
      expect(denied, String(header)).not.toBeNull();
      expect(denied!.status, String(header)).toBe(401);
      expect(denied!.headers.get("cache-control")).toBe("no-store");
      expect(denied!.headers.get("www-authenticate")).toBe("Bearer");
      expect(await codeOf(denied!)).toBe("unauthorized");
    }
  });

  it("refuses the previous secret once the rotation is over (it is no longer configured)", () => {
    expect(checkJobSecret(request(`Bearer ${PREVIOUS}`), { jobSecrets: [CURRENT] })?.status).toBe(401);
  });

  it("never runs unauthenticated: with no secret configured the answer is 503, whatever the request carries", async () => {
    for (const header of [undefined, `Bearer ${CURRENT}`, "Bearer "]) {
      const denied = checkJobSecret(request(header), { jobSecrets: [] });
      expect(denied?.status, String(header)).toBe(503);
      expect(await codeOf(denied!)).toBe("jobs_not_configured");
      expect(denied!.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("says nothing of the secret in any refusal", async () => {
    const body = JSON.stringify(await checkJobSecret(request("Bearer wrong"), { jobSecrets: [CURRENT] })!.json());
    expect(body).not.toContain(CURRENT);
    expect(body).not.toContain("wrong");
  });
});
