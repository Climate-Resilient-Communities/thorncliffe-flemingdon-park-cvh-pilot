import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "../../../contracts/staffRoles";
import { setupGate } from "./setupGate";

describe("setup gate", () => {
  it.each(STAFF_ROLES)("puts a %s with a starting password at gate 1, whatever else is true", (role) => {
    expect(setupGate({ mustChangePassword: true, role, authenticatorEnrolled: true })).toBe("choose_password");
    expect(setupGate({ mustChangePassword: true, role, authenticatorEnrolled: false })).toBe("choose_password");
  });

  it.each(["admin", "coordinator"] as const)("sends a %s without an authenticator to enrolment, then to the Hub", (role) => {
    expect(setupGate({ mustChangePassword: false, role, authenticatorEnrolled: false })).toBe("enrol_authenticator");
    expect(setupGate({ mustChangePassword: false, role, authenticatorEnrolled: true })).toBe("hub");
  });

  it.each(["ambassador", "director"] as const)("sends a %s straight to the Hub once the password is replaced", (role) => {
    expect(setupGate({ mustChangePassword: false, role, authenticatorEnrolled: false })).toBe("hub");
  });
});
