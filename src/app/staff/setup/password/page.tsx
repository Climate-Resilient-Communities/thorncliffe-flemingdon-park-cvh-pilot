import { StaffAuthBrand } from "../../StaffAuthBrand";
import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../../guard";
import { SignOutButton } from "../../SignOutButton";
import { ChoosePasswordForm } from "./ChoosePasswordForm";

export const metadata: Metadata = {
  title: englishText("staff.setup.password.title"),
};

/** "Choose your password": gate 1 of the setup sequence (S01.07). */
export default staffPage(
  {
    route: "/staff/setup/password",
    access: "choose_password",
    action: "account.own_setup",
  },
  () => (
    <main>
      <Screen surface="staff">
        <div className="hub-gate">
          <Stack gap="section-hub">
            <StaffAuthBrand />
            <Stack gap="related">
              <h1>{englishText("staff.setup.password.title")}</h1>
              <p>{englishText("staff.setup.password.lead")}</p>
            </Stack>
            <ChoosePasswordForm
              labels={{
                password: englishText("staff.setup.password.password"),
                passwordHint: englishText("staff.setup.password.passwordHint"),
                confirm: englishText("staff.setup.password.confirm"),
                submit: englishText("staff.setup.password.submit"),
                unavailable: englishText(
                  "staff.setup.password.errors.unavailable",
                ),
              }}
            />
            <SignOutButton label={englishText("staff.signOut")} />
          </Stack>
        </div>
      </Screen>
    </main>
  ),
);
