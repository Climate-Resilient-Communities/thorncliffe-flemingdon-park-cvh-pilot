import { describe, expect, it } from "vitest";
import { STAFF_LOGIN_DOMAIN, loginForUsername, validateNewAccount, type NewAccountInput } from "./newAccount";

const input = (overrides: Partial<NewAccountInput> = {}): NewAccountInput => ({
  username: "jdoe",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane.doe@example.org",
  role: "coordinator",
  ...overrides,
});

describe("new account", () => {
  it("normalises the fields and derives the starting password", () => {
    expect(validateNewAccount(input({ username: "  JDoe ", firstName: " Jane  Mary ", email: " jane@example.org " }))).toEqual({
      ok: true,
      value: {
        username: "jdoe",
        firstName: "Jane Mary",
        lastName: "Doe",
        email: "jane@example.org",
        role: "coordinator",
        startingPassword: "cvh-janemary-doe",
      },
    });
  });

  it.each(["jd", "a".repeat(33), "1jdoe", "j doe", "j..doe", "jdoe.", "_jdoe", "jdöe", "j@doe"])(
    "refuses the username %j",
    (username) => {
      expect(validateNewAccount(input({ username }))).toEqual({ ok: false, error: "username_invalid" });
    },
  );

  it.each(["j.doe", "j_doe", "jane-doe2", "abc", "a".repeat(32)])("accepts the username %j", (username) => {
    expect(validateNewAccount(input({ username })).ok).toBe(true);
  });

  it("refuses missing and over-long names", () => {
    expect(validateNewAccount(input({ firstName: "  " }))).toEqual({ ok: false, error: "first_name_missing" });
    expect(validateNewAccount(input({ lastName: "" }))).toEqual({ ok: false, error: "last_name_missing" });
    expect(validateNewAccount(input({ lastName: "x".repeat(101) }))).toEqual({ ok: false, error: "name_too_long" });
  });

  it("refuses names that reduce to an empty starting password", () => {
    expect(validateNewAccount(input({ firstName: "***" }))).toEqual({ ok: false, error: "starting_password_empty" });
  });

  it.each(["", "jane", "jane@", "jane@example", "ja ne@example.org", `${"a".repeat(250)}@example.org`])("refuses the email %j", (email) => {
    expect(validateNewAccount(input({ email }))).toEqual({ ok: false, error: "email_invalid" });
  });

  it("refuses an unknown role", () => {
    expect(validateNewAccount(input({ role: "superuser" }))).toEqual({ ok: false, error: "role_invalid" });
  });

  it("makes the sign-in login from the username, on a domain that cannot receive mail", () => {
    expect(loginForUsername("jdoe")).toBe("jdoe@staff.cvh.invalid");
    expect(STAFF_LOGIN_DOMAIN.endsWith(".invalid")).toBe(true);
  });
});
