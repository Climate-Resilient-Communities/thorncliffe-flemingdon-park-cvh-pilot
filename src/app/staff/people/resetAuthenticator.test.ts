import { describe, expect, it, vi } from "vitest";
import { englishText } from "@/i18n/text";
import type { FactorRecoveryService, ResetAuthenticatorError } from "@/modules/identity";
import { resetAuthenticatorFromForm } from "./resetAuthenticator";

const SESSION = { staffId: "01900000-0000-7000-8000-000000000001" };
const form = (username: string) => {
  const data = new FormData();
  data.set("username", username);
  return data;
};
const identityWith = (resetAuthenticator: FactorRecoveryService["resetAuthenticator"]) => ({ identity: () => ({ resetAuthenticator }) });

describe("Reset authenticator (the people page's action)", () => {
  it("passes the session's account and the typed username to the module, and says what happened", async () => {
    const resetAuthenticator = vi.fn<FactorRecoveryService["resetAuthenticator"]>(async () => ({ ok: true as const, value: { username: "cmensah", adminShortfall: false, providerCleared: true } }));

    const state = await resetAuthenticatorFromForm(identityWith(resetAuthenticator), SESSION, form("cmensah"));

    expect(resetAuthenticator).toHaveBeenCalledWith(SESSION.staffId, "cmensah");
    expect(state).toEqual({
      status: "reset",
      done: "Authenticator reset for cmensah.",
      line: "They were signed out on every device. At their next sign-in they set up a new authenticator.",
      notes: [],
    });
  });

  it("tells the Admin to restore a second usable Admin when the reset left fewer than two", async () => {
    const resetAuthenticator = vi.fn<FactorRecoveryService["resetAuthenticator"]>(async () => ({ ok: true as const, value: { username: "admin2", adminShortfall: true, providerCleared: false } }));

    const state = await resetAuthenticatorFromForm(identityWith(resetAuthenticator), SESSION, form("admin2"));

    expect(state).toMatchObject({ status: "reset", notes: [englishText("staff.resetAuthenticator.shortfall"), englishText("staff.resetAuthenticator.providerNote")] });
    expect(englishText("staff.resetAuthenticator.shortfall")).toMatch(/fewer than two usable Admins\. Restore a second usable Admin/);
  });

  it.each([
    ["forbidden", "Only an Admin can reset an authenticator."],
    ["not_found", "No account has that username."],
    ["self_action", "You cannot reset your own authenticator. Ask another Admin."],
    ["not_resettable", "This account is suspended or removed, so its authenticator cannot be reset."],
    ["no_authenticator", "Only Admins and Coordinators have an authenticator."],
    ["bootstrap_incomplete", englishText("staff.bootstrap.incomplete")],
  ] as [ResetAuthenticatorError, string][])("shows the refusal %s and keeps the typed username", async (error, message) => {
    const resetAuthenticator = vi.fn<FactorRecoveryService["resetAuthenticator"]>(async () => ({ ok: false as const, error }));

    expect(await resetAuthenticatorFromForm(identityWith(resetAuthenticator), SESSION, form("someone"))).toEqual({ status: "refused", message, username: "someone" });
  });
});

describe("the shortfall banner's text (S01.06, S01.11)", () => {
  it("tells the remaining usable Admin to restore a second usable Admin", () => {
    expect(englishText("staff.admins.shortfallBanner")).toBe("Fewer than two usable Admins");
    expect(englishText("staff.admins.shortfallLine")).toMatch(/^Restore a second usable Admin: reset the password or authenticator of an Admin who cannot sign in/);
  });
});
