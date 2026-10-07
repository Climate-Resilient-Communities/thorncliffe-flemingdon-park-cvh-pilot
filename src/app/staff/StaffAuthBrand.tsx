import Link from "next/link";
import { englishText } from "@/i18n/text";

/** A consistent identity and a way back to the public app throughout staff authentication. */
export function StaffAuthBrand() {
  return (
    <div className="staff-auth-brand">
      <Link href="/en" className="staff-auth-brand__home" aria-label={englishText("staff.signIn.residentLink")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- same local brand asset as the Hub shell */}
        <img src="/brand/hub-logo.png" alt="Thorncliffe Park Community Hub" width={423} height={136} />
      </Link>
      <Link className="hub-link tap" href="/en">{englishText("staff.signIn.residentLink")}</Link>
    </div>
  );
}
