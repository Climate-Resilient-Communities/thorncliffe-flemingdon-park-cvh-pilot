import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GATE_PAGES } from "@/contracts/staffAuth";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { publicStaffPage } from "../guard";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: englishText("staff.signIn.title") };

/** Staff sign-in (S01.07). Public; someone already signed in goes to the page of their setup gate. */
export default publicStaffPage("/staff/sign-in", (session) => {
  if (session) redirect(GATE_PAGES[session.gate]);
  return (
    <main>
      <Screen surface="staff">
        <div className="hub-gate">
          <Stack gap="section-hub">
            <Stack gap="related">
              <h1>{englishText("staff.signIn.title")}</h1>
              <p>{englishText("staff.signIn.lead")}</p>
            </Stack>
            <SignInForm
              labels={{
                username: englishText("staff.signIn.username"),
                password: englishText("staff.signIn.password"),
                submit: englishText("staff.signIn.submit"),
                unavailable: englishText("staff.signIn.unavailable"),
              }}
            />
          </Stack>
        </div>
      </Screen>
    </main>
  );
});
