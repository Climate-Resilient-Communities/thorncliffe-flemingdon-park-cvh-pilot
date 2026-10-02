import type { ReactNode } from "react";
import type { StaffRole } from "@/contracts/staffRoles";
import { HubMenu } from "./hub-menu";
import { HubNav, type HubNavSection } from "./hub-nav";

/** The signed-in person as the shell shows them: the one narrow view model between the shell and the session. */
export type HubShellUser = { displayName: string; role: StaffRole };

export type HubShellLabels = {
  /** "Hub and partner space": the name of the navigation and of the top bar. */
  appName: string;
  menu: string;
  closeMenu: string;
  /** "Signed in as {name}, {role}". */
  signedInAs: string;
  roles: Record<StaffRole, string>;
  logoAlt: string;
};

export type HubShellProps = {
  /** Null when nobody is signed in: the shell is drawn without the person block. */
  user: HubShellUser | null;
  navigation: readonly HubNavSection[];
  /** The path of the page being shown, for the current page in the navigation (null: none). */
  currentPath: string | null;
  labels: HubShellLabels;
  /**
   * The sign-out control (a button with a visible name), shown beside the person. The shell does not know how
   * signing out is done: the app passes the control that calls the sign-out endpoint.
   */
  signOut: ReactNode;
  /** Image files of the Hub logo (the side navigation) and its symbol (the top bar on a phone). */
  brand: { logoSrc: string; symbolSrc: string };
  children?: ReactNode;
};

/** Fills "{name}" and "{role}" of a template; the name is isolated so its script never reorders the sentence. */
function SignedInAs({ template, user, roles }: { template: string; user: HubShellUser; roles: HubShellLabels["roles"] }) {
  return template.split(/(\{name\}|\{role\})/).map((part, index) => {
    if (part === "{name}") return <bdi key={index}>{user.displayName}</bdi>;
    if (part === "{role}") return <span key={index}>{roles[user.role]}</span>;
    return part;
  });
}

/**
 * The frame around every Hub screen (C_HubTop, C_HubSide, HubApp): the side navigation from the Hub breakpoint
 * up; below it a menu button in the top bar opens the same navigation as a drawer. The top bar holds the signed-in
 * person and role and the sign-out button, and wraps, so nothing needs a horizontal scroll at 390 px. The one
 * `<main>` is here; a screen puts a Screen surface="staff" inside it. The document scrolls, not the main.
 */
export function HubShell({ user, navigation, currentPath, labels, signOut, brand, children }: HubShellProps) {
  const logo = (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed brand file, sized by CSS tokens
    <img className="hub-logo" src={brand.logoSrc} alt={labels.logoAlt} width={423} height={136} />
  );
  return (
    <div className="hub-shell" data-surface="staff" data-testid="hub-shell">
      <nav className="hub-side" aria-label={labels.appName} data-testid="hub-side">
        {logo}
        <HubNav sections={navigation} currentPath={currentPath} />
      </nav>
      <div className="hub-column">
        <header className="hub-top" data-testid="hub-top">
          <div className="hub-top__brand">
            <HubMenu labels={{ menu: labels.menu, close: labels.closeMenu }}>
              <nav className="hub-drawer__nav" aria-label={labels.appName} data-testid="hub-drawer-nav">
                {logo}
                <HubNav sections={navigation} currentPath={currentPath} />
              </nav>
            </HubMenu>
            {/* eslint-disable-next-line @next/next/no-img-element -- decorative: the name beside it says what it is */}
            <img className="hub-symbol" src={brand.symbolSrc} alt="" width={96} height={96} />
            <span className="hub-top__app">{labels.appName}</span>
          </div>
          {user && (
            <div className="hub-top__who" data-testid="hub-who">
              <p className="hub-top__person" data-testid="hub-person">
                <SignedInAs template={labels.signedInAs} user={user} roles={labels.roles} />
              </p>
              <div className="hub-top__signout" data-testid="hub-sign-out">
                {signOut}
              </div>
            </div>
          )}
        </header>
        <main className="hub-main" data-testid="hub-main">
          {children}
        </main>
      </div>
    </div>
  );
}
