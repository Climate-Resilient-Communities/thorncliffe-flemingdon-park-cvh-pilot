import { BasicSwitch } from "../basic";
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
 */
export function ResidentShell({ header, nav, children }: ResidentShellProps) {
  return (
    <div className="shell" data-testid="shell">
      <ResidentHeader {...header} />
      <main className="shell__main" data-testid="shell-main">
        {children}
      </main>
      <ResidentNav {...nav} />
      <footer className="shell-footer">
        <Link href="/staff/sign-in" lang={header.current === "fr" ? "fr" : "en"}>
          {header.current === "fr" ? "Connexion du personnel" : "Staff sign in"}
        </Link>
        <details className="shell-tools">
          <summary className="tap" lang={header.current === "fr" ? "fr" : "en"}>
            {header.current === "fr" ? "Affichage" : "Display settings"}
          </summary>
          <BasicSwitch labels={header.basic} />
        </details>
      </footer>

    </div>
  );
}
