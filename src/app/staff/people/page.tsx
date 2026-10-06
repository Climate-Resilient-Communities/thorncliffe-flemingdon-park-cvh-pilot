import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../guard";
import { identity } from "../identity";
import { ProcedureLink } from "../ProcedureLink";
import { procedureLink } from "../procedures";
import { AddPersonBody } from "./AddPersonBody";
import { ReissueForm } from "./ReissueForm";
import { ResetAuthenticatorForm } from "./ResetAuthenticatorForm";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { title: englishText("staff.people.title") };

/**
 * The page's heading and lead, shown to everyone who reaches it, and the procedure for rotating secrets (S09.03): someone leaving the Hub starts here, with a
 * password reset that signs them out on every device.
 */
function PeopleHeading() {
  return (
    <Stack gap="related">
      <h1>{englishText("staff.people.title")}</h1>
      <p>{englishText("staff.people.lead")}</p>
      <ProcedureLink link={procedureLink("rotate-secrets")} />
    </Stack>
  );
}

/**
 * "Add a person" (S01.05), with "Re-issue a starting password" (S01.07), "Reset password" (S01.08) and "Reset authenticator" (S01.11):
 * the policy action `accounts.manage`, Admins only (S01.12). Staff at the Hub only (the guard sends
 * everyone else to sign-in or their setup gate); another role sees "Only an Admin can add people."
 * and no form, and each action of the page refuses it on its own. Responses are no-store. The shell
 * (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/people",
    access: "hub",
    action: "accounts.manage",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <PeopleHeading />
          <AddPersonBody view={{ allowed: false, refusal: "forbidden" }} />
        </Stack>
      </Screen>
    ),
  },
  async (session) => {
    const view = await identity().addPersonView(session.staffId);
    return (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <PeopleHeading />
          <AddPersonBody view={view} />
          <ResetPasswordForm
            labels={{
              title: englishText("staff.resetPassword.title"),
              lead: englishText("staff.resetPassword.lead"),
              username: englishText("staff.resetPassword.username"),
              submit: englishText("staff.resetPassword.submit"),
            }}
          />
          <ResetAuthenticatorForm
            labels={{
              title: englishText("staff.resetAuthenticator.title"),
              lead: englishText("staff.resetAuthenticator.lead"),
              username: englishText("staff.resetAuthenticator.username"),
              submit: englishText("staff.resetAuthenticator.submit"),
            }}
          />
          <ReissueForm
            labels={{
              title: englishText("staff.reissue.title"),
              lead: englishText("staff.reissue.lead"),
              username: englishText("staff.reissue.username"),
              submit: englishText("staff.reissue.submit"),
            }}
          />
        </Stack>
      </Screen>
    );
  },
);
