/* eslint-disable @next/next/no-html-link-for-pages -- Staff navigation reloads session and safety banners; resident destinations cross root layouts. */
import type { ReactNode } from "react";
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";

/** The Hub logo's file; a test fixture rendered without a base URL passes the same image as a data URI. */
export const HUB_LOGO_SRC = "/brand/hub-logo.png";

/**
 * The frame of every staff page outside the Hub shell (sign-in, the authenticator code, the two setup gates): a header with
 * the Hub logo, the page's own <main> and a quiet footer with the terms and the way back to the resident app. The logo is
 * itself the header's link back to the resident app, so the header holds nothing else and fits a 320 px phone; the footer
 * repeats that link in words, after the page's form and help, where it does not compete with the form's action.
 */
export function StaffAuthFrame({ logoSrc = HUB_LOGO_SRC, children }: { logoSrc?: string; children: ReactNode }) {
  return (
    <div className="staff-auth" data-surface="staff">
      <header className="staff-auth__bar staff-auth__header">
        <a href="/en" className="staff-auth__home" aria-label={englishText("staff.signIn.residentLink")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- same local brand asset as the Hub shell */}
          <img src={logoSrc} alt="Thorncliffe Park Community Hub" width={423} height={136} />
        </a>
      </header>
      <main className="staff-auth__main">
        <Screen surface="staff">{children}</Screen>
      </main>
      <footer className="staff-auth__bar staff-auth__footer">
        <a className="staff-auth__footer-link tap" href="/en/terms">{englishText("staff.journey.privacy")}</a>
        <a className="staff-auth__footer-link tap" href="/en">{englishText("staff.signIn.residentLink")}</a>
      </footer>
    </div>
  );
}
