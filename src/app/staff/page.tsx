import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { staffPage } from "./guard";
import { SignOutButton } from "./SignOutButton";

export const metadata: Metadata = { title: englishText("staff.hub.title") };

/** The Hub: a placeholder at the last gate of the setup sequence until S01.09 builds the shell. */
export default staffPage({ route: "/staff", access: "hub" }, (session) => (
  <main>
    <Screen surface="staff">
      <Stack gap="section-hub">
        <Stack gap="related">
          <h1>{englishText("staff.hub.title")}</h1>
          <p>
            {englishText("staff.signedInAs", {
              name: `${session.firstName} ${session.lastName}`,
              role: englishText(`staff.roles.${session.role}`),
            })}
          </p>
        </Stack>
        {session.role === "admin" && (
          <a className="tap" href="/staff/people">
            {englishText("staff.hub.addPerson")}
          </a>
        )}
        <SignOutButton label={englishText("staff.signOut")} />
      </Stack>
    </Screen>
  </main>
));
