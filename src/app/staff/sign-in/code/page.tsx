import { StaffAuthBrand } from "../../StaffAuthBrand";
import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { AuthenticatorCodeForm } from "../../AuthenticatorCodeForm";
import { staffPage } from "../../guard";
import { SignOutButton } from "../../SignOutButton";

export const metadata: Metadata = {
  title: englishText("staff.authenticator.code.title"),
};

/**
 * The sign-in's authenticator code (S01.10): an Admin or Coordinator with an authenticator enters
 * one code after the password; the session is then `aal2` for its 12 hours and no other code is
 * asked. Until then only this page, `POST /api/staff/factor/verify`, `GET /api/staff/me` and
 * sign-out are reachable.
 */
export default staffPage(
  {
    route: "/staff/sign-in/code",
    access: "authenticator_code",
    action: "account.own_setup",
  },
  () => (
    <main>
      <Screen surface="staff">
        <div className="hub-gate">
          <Stack gap="section-hub">
            <StaffAuthBrand />
            <Stack gap="related">
              <h1>{englishText("staff.authenticator.code.title")}</h1>
              <p>{englishText("staff.authenticator.code.lead")}</p>
            </Stack>
            <AuthenticatorCodeForm
              labels={{
                code: englishText("staff.authenticator.code.code"),
                submit: englishText("staff.authenticator.code.submit"),
                unavailable: englishText(
                  "staff.authenticator.errors.unavailable",
                ),
              }}
            />
            <p>{englishText("staff.authenticator.code.lost")}</p>
            <SignOutButton label={englishText("staff.signOut")} />
          </Stack>
        </div>
      </Screen>
    </main>
  ),
);
