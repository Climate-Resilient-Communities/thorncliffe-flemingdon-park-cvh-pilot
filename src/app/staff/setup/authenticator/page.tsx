import { StaffAuthBrand } from "../../StaffAuthBrand";
import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../../guard";
import { SignOutButton } from "../../SignOutButton";
import { EnrolAuthenticator } from "./EnrolAuthenticator";

export const metadata: Metadata = {
  title: englishText("staff.setup.authenticator.title"),
};

/**
 * Gate 2 of the setup sequence (S01.10): an Admin or Coordinator without an authenticator sets one
 * up here. Only this page, `POST /api/staff/factor/enrol` and `/verify`, `GET /api/staff/me` and
 * sign-out are reachable until the first code is accepted; then the session is `aal2` and the
 * person enters the Hub.
 */
export default staffPage(
  {
    route: "/staff/setup/authenticator",
    access: "enrol_authenticator",
    action: "account.own_setup",
  },
  () => (
    <main>
      <Screen surface="staff">
        <div className="hub-gate">
          <Stack gap="section-hub">
            <StaffAuthBrand />
            <Stack gap="related">
              <h1>{englishText("staff.setup.authenticator.title")}</h1>
              <p>{englishText("staff.setup.authenticator.lead")}</p>
              <p>{englishText("staff.setup.authenticator.install")}</p>
            </Stack>
            <EnrolAuthenticator
              labels={{
                start: englishText("staff.setup.authenticator.start"),
                scan: englishText("staff.setup.authenticator.scan"),
                qrAlt: englishText("staff.setup.authenticator.qrAlt"),
                key: englishText("staff.setup.authenticator.key", {
                  key: "{key}",
                }),
                keyHint: englishText("staff.setup.authenticator.keyHint"),
                unavailable: englishText(
                  "staff.authenticator.errors.unavailable",
                ),
                code: {
                  code: englishText("staff.setup.authenticator.code"),
                  submit: englishText("staff.setup.authenticator.submit"),
                  unavailable: englishText(
                    "staff.authenticator.errors.unavailable",
                  ),
                },
              }}
            />
            <SignOutButton label={englishText("staff.signOut")} />
          </Stack>
        </div>
      </Screen>
    </main>
  ),
);
