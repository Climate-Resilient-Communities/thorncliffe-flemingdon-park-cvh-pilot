import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { staffPage } from "./guard";

export const metadata: Metadata = { title: englishText("staff.hub.title") };

/**
 * The Hub's home: a placeholder at the last gate of the setup sequence until the incidents screen (S04.10) replaces
 * it. The person, the sign-out button and the navigation are the shell's (layout.tsx), which also owns the <main>.
 */
export default staffPage({ route: "/staff", access: "hub", action: "hub.open" }, () => (
  <Screen surface="staff">
    <Stack gap="related">
      <h1>{englishText("staff.hub.title")}</h1>
      <p>{englishText("staff.hub.lead")}</p>
    </Stack>
  </Screen>
));
