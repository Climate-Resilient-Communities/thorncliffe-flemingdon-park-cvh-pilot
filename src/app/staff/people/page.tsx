import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { can } from "@/modules/identity";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../guard";
import { identity } from "../identity";
import { AddPersonBody } from "./AddPersonBody";
import { ReissueForm } from "./ReissueForm";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { title: englishText("staff.people.title") };

/**
 * "Add a person" (S01.05), with "Re-issue a starting password" (S01.07) and "Reset password" (S01.08)
 * for Admins. Staff at the
 * Hub only (the guard sends everyone else to sign-in or their setup gate); responses are no-store.
 */
export default staffPage({ route: "/staff/people", access: "hub", action: "accounts.manage" }, async (session) => {
  const view = await identity().addPersonView(session.staffId);
  return (
    <main>
      <Screen surface="staff">
        <Stack gap="section-hub">
          <Stack gap="related">
            <h1>{englishText("staff.people.title")}</h1>
            <p>{englishText("staff.people.lead")}</p>
          </Stack>
          <AddPersonBody view={view} />
          {can(session.role, "accounts.manage") && (
            <ResetPasswordForm
              labels={{
                title: englishText("staff.resetPassword.title"),
                lead: englishText("staff.resetPassword.lead"),
                username: englishText("staff.resetPassword.username"),
                submit: englishText("staff.resetPassword.submit"),
              }}
            />
          )}
          {session.role === "admin" && (
            <ReissueForm
              labels={{
                title: englishText("staff.reissue.title"),
                lead: englishText("staff.reissue.lead"),
                username: englishText("staff.reissue.username"),
                submit: englishText("staff.reissue.submit"),
              }}
            />
          )}
        </Stack>
      </Screen>
    </main>
  );
});
