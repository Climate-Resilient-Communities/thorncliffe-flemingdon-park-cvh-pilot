// Stands in for src/app/staff/people/actions.ts in the screenshot harness (e2e/helpers/layout-fixture.ts), which renders
// the People forms without a server. The real module is "use server" and reaches the database; every action here does
// nothing and leaves the form idle. A refusal or a done message is photographed by starting the form in that state
// (the forms' `initialState`). Only the harness uses this file.
import type { AddPersonState } from "../../src/app/staff/people/addPerson";
import type { ReissueState } from "../../src/app/staff/people/reissue";
import type { ResetAuthenticatorState } from "../../src/app/staff/people/resetAuthenticator";
import type { ResetPasswordState } from "../../src/app/staff/people/resetPassword";

export async function addPersonAction(): Promise<AddPersonState> {
  return { status: "idle" };
}
export async function reissueAction(): Promise<ReissueState> {
  return { status: "idle" };
}
export async function resetPasswordAction(): Promise<ResetPasswordState> {
  return { status: "idle" };
}
export async function resetAuthenticatorAction(): Promise<ResetAuthenticatorState> {
  return { status: "idle" };
}
