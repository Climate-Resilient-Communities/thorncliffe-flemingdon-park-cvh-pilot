import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { StaffAuthBrand } from "../StaffAuthBrand";
import { SignInForm } from "./SignInForm";

/** Shared by the public route and visual fixtures; recovery follows the Admin-managed pilot process. */
export function StaffSignInView() {
  return (
    <main>
      <Screen surface="staff">
        <div className="staff-signin">
          <StaffAuthBrand />
          <header>
            <Stack gap="related">
              <h1>{englishText("staff.signIn.title")}</h1>
              <p>{englishText("staff.signIn.audience")}</p>
            </Stack>
          </header>
          <div className="staff-signin__columns">
            <section className="staff-signin__form" aria-labelledby="account-title">
              <Stack gap="section-hub">
                <h2 id="account-title">{englishText("staff.signIn.accountTitle")}</h2>
                <SignInForm labels={{ username: englishText("staff.signIn.username"), password: englishText("staff.signIn.password"), submit: englishText("staff.signIn.submit"), unavailable: englishText("staff.signIn.unavailable") }} />
                <details className="staff-signin__recovery">
                  <summary className="hub-link tap">{englishText("staff.signIn.forgot")}</summary>
                  <Stack gap="related">
                    <p>{englishText("staff.signIn.recovery")}</p>
                    <p>{englishText("staff.signIn.recoveryPrivacy")}</p>
                  </Stack>
                </details>
              </Stack>
            </section>
            <aside className="staff-signin__help" aria-labelledby="new-staff-title">
              <Stack gap="section-hub">
                <h2 id="new-staff-title">{englishText("staff.signIn.newTitle")}</h2>
                <p>{englishText("staff.signIn.newLead")}</p>
                <ol className="staff-signin__steps">
                  <li>{englishText("staff.signIn.stepAccount")}</li>
                  <li>{englishText("staff.signIn.stepPassword")}</li>
                  <li>{englishText("staff.signIn.stepAuthenticator")}</li>
                </ol>
                <p className="hub-muted">{englishText("staff.signIn.expiredHelp")}</p>
              </Stack>
            </aside>
          </div>
        </div>
      </Screen>
    </main>
  );
}
