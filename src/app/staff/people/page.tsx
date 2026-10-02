import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../guard";
import { identity } from "../identity";
import { AddPersonBody } from "./AddPersonBody";
import { ReissueForm } from "./ReissueForm";

export const metadata: Metadata = { title: englishText("staff.people.title") };

/**
 * "Add a person" (S01.05), with "Re-issue a starting password" (S01.07) for Admins. Staff at the
 * Hub only (the guard sends everyone else to sign-in or their setup gate); responses are no-store.
 * The shell (layout.tsx) owns the <main>.
 */
export default staffPage({ route: "/staff/people", access: "hub" }, async (session) => {
  const view = await identity().addPersonView(session.staffId);
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <Stack gap="related">
          <h1>{englishText("staff.people.title")}</h1>
          <p>{englishText("staff.people.lead")}</p>
        </Stack>
        <AddPersonBody view={view} />
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
  );
});
