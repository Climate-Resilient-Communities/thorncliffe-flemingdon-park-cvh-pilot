import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "../../../contracts/staffRoles";
import { needsAuthenticator, setupGate } from "./setupGate";

describe("setup gate", () => {
  it.each(STAFF_ROLES)("puts a %s with a starting password at gate 1, whatever else is true", (role) => {
    for (const aal of ["aal1", "aal2"] as const) {
      expect(setupGate({ mustChangePassword: true, role, authenticatorEnrolled: true, aal })).toBe("choose_password");
      expect(setupGate({ mustChangePassword: true, role, authenticatorEnrolled: false, aal })).toBe("choose_password");
    }
  });

  it.each(["admin", "coordinator"] as const)("sends a %s without an authenticator to enrolment, with one to the code until aal2, then to the Hub", (role) => {
    expect(setupGate({ mustChangePassword: false, role, authenticatorEnrolled: false, aal: "aal1" })).toBe("enrol_authenticator");
    // A provider session at aal2 does not skip enrolment: the app's own record is missing.
    expect(setupGate({ mustChangePassword: false, role, authenticatorEnrolled: false, aal: "aal2" })).toBe("enrol_authenticator");
    expect(setupGate({ mustChangePassword: false, role, authenticatorEnrolled: true, aal: "aal1" })).toBe("authenticator_code");
    expect(setupGate({ mustChangePassword: false, role, authenticatorEnrolled: true, aal: "aal2" })).toBe("hub");
    expect(needsAuthenticator(role)).toBe(true);
  });

  it.each(["ambassador", "director"] as const)("sends a %s straight to the Hub once the password is replaced, with no code", (role) => {
    for (const authenticatorEnrolled of [false, true]) {
      expect(setupGate({ mustChangePassword: false, role, authenticatorEnrolled, aal: "aal1" })).toBe("hub");
    }
    expect(needsAuthenticator(role)).toBe(false);
  });
});
