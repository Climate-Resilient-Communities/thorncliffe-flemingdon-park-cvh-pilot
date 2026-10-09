import Link from "next/link";
import type { ReactNode } from "react";
import { ResidentHeader, type ResidentHeaderProps } from "./resident-header";
import { MainScrollFocus } from "./main-scroll-focus";
import { ResidentNav, type ResidentNavProps } from "./resident-nav";
import { ResidentText } from "../text/resident-text";

/** The footer's two links in the page's language (the catalog's shell.staffSignIn and shell.termsLink). */
export type ResidentFooterLabels = { staffSignIn: string; termsLink: string };

export type ResidentShellProps = {
  header: ResidentHeaderProps;
  nav: ResidentNavProps;
  footer: ResidentFooterLabels;
  children?: ReactNode;
};

/**
 * The frame around every resident screen (component-boundaries.md section 3.1): header, the one scrolling main,
 * bottom navigation. A screen puts a Screen surface="resident" inside the main; the shell adds no inset.
 * From the desktop breakpoint (resident-wide) the navigation is the header's row instead of the bottom bar, the page
 * scrolls as a whole and the footer follows the page (shell.css).
 */
export function ResidentShell({ header, nav, footer, children }: ResidentShellProps) {
  return (
    <div className="shell" data-testid="shell">
      <ResidentHeader {...header} nav={nav} />
      <main id="shell-main" className="shell__main" data-testid="shell-main">
        {children}
      </main>
      <MainScrollFocus mainId="shell-main" />
      <ResidentNav {...nav} />
      {/* The footer's words come from the catalog in the page's language; one that fell back to English is an isolated English run.
          prefetch off, as the shell's other links: Next would otherwise fetch both pages as soon as the footer is on screen. */}
      <footer className="shell-footer" data-testid="shell-footer">
        <Link href="/staff/sign-in" prefetch={false} data-testid="shell-footer-staff">
          <ResidentText>{footer.staffSignIn}</ResidentText>
        </Link>
        <Link href={`/${header.current}/terms`} prefetch={false} data-testid="shell-footer-terms">
          <ResidentText>{footer.termsLink}</ResidentText>
        </Link>
      </footer>

    </div>
  );
}
