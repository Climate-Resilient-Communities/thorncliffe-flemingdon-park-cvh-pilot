import { describe, expect, it } from "vitest";
import { startingPasswordStanding } from "./startingPasswordWindow";

const issued = new Date("2026-10-01T12:00:00Z");
const account = { status: "active" as const, mustChangePassword: true, startingPasswordIssuedAt: issued, startingPasswordUsedAt: null };
const at = (iso: string) => new Date(iso);

describe("starting password standing", () => {
  it("is valid for 24 hours from issue", () => {
    expect(startingPasswordStanding(account, at("2026-10-01T12:00:00Z"))).toBe("valid");
    expect(startingPasswordStanding(account, at("2026-10-02T11:59:59.999Z"))).toBe("valid");
  });

  it("expires 24 hours after issue", () => {
    expect(startingPasswordStanding(account, at("2026-10-02T12:00:00Z"))).toBe("expired");
  });

  it("is used after its one successful sign-in", () => {
    expect(startingPasswordStanding({ ...account, startingPasswordUsedAt: issued }, at("2026-10-01T13:00:00Z"))).toBe("used");
  });

  it("stays expired while the account waits for a re-issue", () => {
    expect(startingPasswordStanding({ ...account, status: "locked_pending_reissue" }, at("2026-10-01T13:00:00Z"))).toBe("expired");
  });

  it("does not apply once the person has their own password", () => {
    expect(startingPasswordStanding({ ...account, mustChangePassword: false, startingPasswordIssuedAt: null }, at("2026-12-01T00:00:00Z"))).toBe("none");
  });
});
