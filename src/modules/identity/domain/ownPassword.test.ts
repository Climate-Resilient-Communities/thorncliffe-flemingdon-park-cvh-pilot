import { describe, expect, it } from "vitest";
import { validateOwnPassword } from "./ownPassword";

const account = { username: "jdoe", startingPassword: "rvh-jane-doe" };
const check = (password: string, confirm = password) => validateOwnPassword({ password, confirm }, account);

describe("own password", () => {
  it("accepts 10 characters or more that avoid the username and the starting password", () => {
    expect(check("correct horse")).toEqual({ ok: true, value: "correct horse" });
    expect(check("a".repeat(10)).ok).toBe(true);
  });

  it("refuses fewer than 10 characters, counting characters rather than bytes", () => {
    expect(check("a".repeat(9))).toEqual({ ok: false, error: "password_too_short" });
    expect(check("ب".repeat(9))).toEqual({ ok: false, error: "password_too_short" });
    expect(check("ب".repeat(10)).ok).toBe(true);
  });

  it("refuses more than 72 bytes, the most Supabase Auth accepts", () => {
    expect(check("a".repeat(72)).ok).toBe(true);
    expect(check("a".repeat(73))).toEqual({ ok: false, error: "password_too_long" });
    expect(check("ب".repeat(37))).toEqual({ ok: false, error: "password_too_long" });
  });

  it("refuses a password containing the username in any case", () => {
    expect(check("my-JDoe-password")).toEqual({ ok: false, error: "password_contains_username" });
    expect(check("jdoejdoejdoe")).toEqual({ ok: false, error: "password_contains_username" });
  });

  it("refuses the starting password in any case", () => {
    const longStart = { username: "jdoe", startingPassword: "rvh-janemary-doe" };
    expect(validateOwnPassword({ password: "RVH-JaneMary-Doe", confirm: "RVH-JaneMary-Doe" }, longStart)).toEqual({
      ok: false,
      error: "password_is_starting_password",
    });
    expect(validateOwnPassword({ password: "rvh-janemary-doe!", confirm: "rvh-janemary-doe!" }, longStart).ok).toBe(true);
  });

  it("refuses a confirmation that differs", () => {
    expect(check("correct horse", "correct hors")).toEqual({ ok: false, error: "password_mismatch" });
  });
});
