import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../../guard";
import { SignOutButton } from "../../SignOutButton";

export const metadata: Metadata = { title: englishText("staff.setup.authenticator.title") };

/**
 * Gate 2 of the setup sequence: Admins and Coordinators without an authenticator. A placeholder
 * until S01.10 builds the enrolment here (its page, `POST /api/staff/factor/enrol` and
 * `/verify`); until then the gate holds them here, so nobody reaches the Hub without one.
 */
export default staffPage({ route: "/staff/setup/authenticator", access: "enrol_authenticator" }, () => (
  <main>
    <Screen surface="staff">
      <Stack gap="section-hub">
        <Stack gap="related">
          <h1>{englishText("staff.setup.authenticator.title")}</h1>
          <p>{englishText("staff.setup.authenticator.lead")}</p>
          <p>{englishText("staff.setup.authenticator.notYet")}</p>
        </Stack>
        <SignOutButton label={englishText("staff.signOut")} />
      </Stack>
    </Screen>
  </main>
));
