import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { identity } from "../identity";
import { currentStaffSession } from "../session";
import { AddPersonBody } from "./AddPersonBody";

export const metadata: Metadata = { title: englishText("staff.people.title") };

/** "Add a person" (S01.05). Staff only: without a session it sends to sign-in; responses are no-store (next.config.ts). */
export default async function AddPersonPage() {
  const session = await currentStaffSession();
  if (!session) redirect("/staff/sign-in");
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
        </Stack>
      </Screen>
    </main>
  );
}
