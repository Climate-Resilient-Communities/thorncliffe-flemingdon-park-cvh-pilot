/* eslint-disable @next/next/no-html-link-for-pages -- Staff navigation reloads session and safety banners; resident destinations cross root layouts. */
import { englishText } from "@/i18n/text";

/** The Hub logo's file; a test fixture rendered without a base URL passes the same image as a data URI. */
export const HUB_LOGO_SRC = "/brand/hub-logo.png";

/** A consistent identity and a way back to the public app throughout staff authentication. */
export function StaffAuthBrand({ logoSrc = HUB_LOGO_SRC }: { logoSrc?: string }) {
  return (
    <div className="staff-auth-brand">
      <a href="/en" className="staff-auth-brand__home" aria-label={englishText("staff.signIn.residentLink")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- same local brand asset as the Hub shell */}
        <img src={logoSrc} alt="Thorncliffe Park Community Hub" width={423} height={136} />
      </a>
      <a className="hub-link tap" href="/en">{englishText("staff.signIn.residentLink")}</a>
      <a className="hub-link tap" href="/en/terms">{englishText("staff.journey.privacy")}</a>
    </div>
  );
}
