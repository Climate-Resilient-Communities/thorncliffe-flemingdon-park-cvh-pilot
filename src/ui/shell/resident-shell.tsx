import Link from "next/link";
import type { ReactNode } from "react";
import { ResidentHeader, type ResidentHeaderProps } from "./resident-header";
import { ResidentNav, type ResidentNavProps } from "./resident-nav";

export type ResidentShellProps = {
  header: ResidentHeaderProps;
  nav: ResidentNavProps;
  children?: ReactNode;
};

/**
 * The frame around every resident screen (component-boundaries.md section 3.1): header, the one scrolling main,
 * bottom navigation. A screen puts a Screen surface="resident" inside the main; the shell adds no inset.
 * From the desktop breakpoint (resident-wide) the navigation is the header's row instead of the bottom bar, the page
 * scrolls as a whole and the footer follows the page (shell.css).
 */
export function ResidentShell({ header, nav, children }: ResidentShellProps) {
  return (
    <div className="shell" data-testid="shell">
      <ResidentHeader {...header} nav={nav} />
      <main className="shell__main" data-testid="shell-main">
        {children}
      </main>
      <ResidentNav {...nav} />
      {/* The footer's words are English or French (fr) until they are translated, so they carry their language and direction.
          prefetch off, as the shell's other links: Next would otherwise fetch both pages as soon as the footer is on screen. */}
      <footer className="shell-footer" data-testid="shell-footer">
        <Link href="/staff/sign-in" prefetch={false} lang={header.current === "fr" ? "fr" : "en"} dir="ltr">
          {header.current === "fr" ? "Connexion du personnel" : "Staff sign in"}
        </Link>
        <Link href={`/${header.current}/terms`} prefetch={false} lang={header.current === "fr" ? "fr" : "en"} dir="ltr">
          {header.current === "fr" ? "Conditions et confidentialité" : "Terms and privacy"}
        </Link>
      </footer>

    </div>
  );
}
