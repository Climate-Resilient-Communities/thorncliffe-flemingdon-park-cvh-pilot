import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { layoutDeclarations, layoutLiterals, literalLengths, physicalDeclarations, readSource } from "../../../test/helpers/layout-css";
import { HubShell, type HubShellProps } from "./hub-shell";
import { HubNav, isCurrentPage } from "./hub-nav";

const css = layoutDeclarations("src/ui/hub/hub-shell.css");
const icons = layoutDeclarations("src/ui/hub/hub-icons.css");

const props: HubShellProps = {
  user: { displayName: "Priya Sharma", role: "coordinator" },
  navigation: [
    {
      id: "a",
      label: "In a disruption",
      items: [
        { id: "home", label: "Incidents", href: "/staff", exact: true, icon: "now" },
        { id: "soon", label: "Compose an alert", href: null, icon: "pencil" },
      ],
    },
  ],
  currentPath: "/staff",
  labels: {
    appName: "Hub and partner space",
    menu: "Menu",
    closeMenu: "Close menu",
    signedInAs: "Signed in as {name}, {role}",
    roles: { ambassador: "Ambassador", coordinator: "Coordinator", director: "Director", admin: "Admin" },
    logoAlt: "Thorncliffe Park Community Hub",
  },
  signOut: <button type="submit">Sign out</button>,
  brand: { logoSrc: "/brand/hub-logo.png", symbolSrc: "/brand/hub-symbol.png" },
};

describe("HubShell", () => {
  const html = renderToStaticMarkup(<HubShell {...props}>screen</HubShell>);

  it("has one navigation in the side and one in the menu drawer, each named, and one main with the screen", () => {
    expect(html.match(/<nav /g)).toHaveLength(2);
    expect(html.match(/aria-label="Hub and partner space"/g)).toHaveLength(2);
    expect(html.match(/<main /g)).toHaveLength(1);
    expect(html).toContain('<main class="hub-main" data-testid="hub-main">screen</main>');
    expect(html.match(/<header /g)).toHaveLength(1);
  });

  it("names the menu button and the dialog, and the close button", () => {
    expect(html).toContain('aria-label="Menu" aria-haspopup="dialog"');
    expect(html).toContain('<dialog class="hub-drawer" aria-label="Menu"');
    expect(html).toContain('aria-label="Close menu"');
    // Icons are decorative; the logo has its text alternative and the symbol has none.
    expect(html.match(/class="hub-ico hub-ico--[a-z]+" aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('alt="Thorncliffe Park Community Hub"');
    expect(html).toContain('<img class="hub-symbol" src="/brand/hub-symbol.png" alt=""');
  });

  it("shows the person and role in one sentence with the name isolated, and the app's sign-out control", () => {
    expect(html).toContain('<p class="hub-top__person" data-testid="hub-person">Signed in as <bdi>Priya Sharma</bdi>, <span>Coordinator</span></p>');
    expect(html).toContain('<div class="hub-top__signout" data-testid="hub-sign-out"><button type="submit">Sign out</button></div>');
  });

  it("is drawn without the person block when nobody is signed in", () => {
    const signedOut = renderToStaticMarkup(<HubShell {...props} user={null} />);

    expect(signedOut).not.toContain("hub-top__who");
    expect(signedOut).not.toContain("Sign out");
    expect(signedOut).toContain('class="hub-top"');
  });

  it("is the staff surface, so its text takes the staff type set", () => {
    expect(html).toContain('<div class="hub-shell" data-surface="staff"');
  });

  it("announces the current page on its link only, and lists an unbuilt page as text", () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(2); // the side's and the drawer's copy
    expect(html).toContain('<a class="hub-nav__item tap" href="/staff" aria-current="page"');
    expect(html).toContain('<span class="hub-nav__item hub-nav__item--unbuilt"');
    expect(html).not.toMatch(/<a [^>]*>[^<]*(<span[^>]*><\/span>)?<span class="hub-nav__label">Compose an alert/);
  });
});

describe("the current page", () => {
  const item = (href: string | null, exact = false) => ({ href, exact });

  it("is the item's path or a page below it, never a path that only starts with the same letters", () => {
    expect(isCurrentPage("/staff/people", item("/staff/people"))).toBe(true);
    expect(isCurrentPage("/staff/people/", item("/staff/people"))).toBe(true);
    expect(isCurrentPage("/staff/people/new", item("/staff/people"))).toBe(true);
    expect(isCurrentPage("/staff/peoples", item("/staff/people"))).toBe(false);
    expect(isCurrentPage("/staff", item("/staff/people"))).toBe(false);
  });

  it("is the exact path only for the home, which every staff page is below", () => {
    expect(isCurrentPage("/staff", item("/staff", true))).toBe(true);
    expect(isCurrentPage("/staff/", item("/staff", true))).toBe(true);
    expect(isCurrentPage("/staff/people", item("/staff", true))).toBe(false);
  });

  it("is nothing for an unknown path or an item without a page", () => {
    expect(isCurrentPage(null, item("/staff"))).toBe(false);
    expect(isCurrentPage("/staff", item(null))).toBe(false);
    expect(renderToStaticMarkup(<>{HubNav({ sections: props.navigation, currentPath: null })}</>)).not.toContain("aria-current");
  });
});

describe("hub-shell.css", () => {
  it("switches between the two layouts only with the hub: variant (the Hub breakpoint token) and has no media or container query", () => {
    const variants = new Set(css.flatMap((d) => d.at));
    expect([...variants]).toEqual(["@variant hub"]);
    const text = readSource("src/ui/hub/hub-shell.css");
    expect(text).not.toMatch(/@media|@container|@custom-variant/);
    expect(text).not.toMatch(layoutLiterals());
    expect(readSource("src/ui/hub/hub-icons.css")).not.toMatch(layoutLiterals());
  });

  it("shows the side navigation, hides the menu button and the drawer, and sets the sidebar column from the tokens, from the breakpoint up", () => {
    const at = (selector: string) => css.filter((d) => d.selector.startsWith(selector) && d.at.includes("@variant hub")).map((d) => `${d.prop}: ${d.value}`);

    expect(at(".hub-shell")).toEqual(["grid-template-columns: var(--size-side-nav) minmax(0, 1fr)"]);
    expect(at(".hub-side")).toContain("display: flex");
    expect(css.find((d) => d.selector === ".hub-side" && !d.at.length && d.prop === "display")?.value).toBe("none");
    expect(at(".hub-menu-button")).toEqual(["display: none"]);
    expect(at(".hub-drawer")).toContain("display: none");
    expect(at(".hub-top__brand")).toEqual(["display: none"]);
  });

  it("keeps the top bar at least the token height, wrapping, and switches its inset with the page's", () => {
    const top = css.filter((d) => d.selector === ".hub-top");

    expect(top.find((d) => d.prop === "min-block-size")?.value).toBe("var(--size-topbar-hub-min)");
    expect(top.find((d) => d.prop === "flex-wrap")?.value).toBe("wrap");
    expect(top.find((d) => d.prop === "padding-inline" && !d.at.length)?.value).toBe("var(--inset-page-staff-narrow)");
    expect(top.find((d) => d.prop === "padding-inline" && d.at.length)?.value).toBe("var(--inset-page-staff)");
    expect(top.some((d) => d.prop === "block-size" || d.prop === "height")).toBe(false);
  });

  it("has no literal length (the viewport's own height aside), no physical property, no [dir] rule", () => {
    const own = [...css, ...icons];
    const lengths = literalLengths(own).filter((d) => d.value.trim() !== "100dvh" && !d.prop.includes("mask-image"));

    expect(lengths.map((d) => `${d.selector} ${d.prop}: ${d.value}`)).toEqual([]);
    expect(physicalDeclarations(own)).toEqual([]);
    expect(readSource("src/ui/hub/hub-shell.css")).not.toMatch(/\[dir|:dir\(/);
  });

  it("gives every control at least the tap size through the tap rule", () => {
    const sources = ["hub-menu.tsx", "hub-nav.tsx"].map((file) => readSource(`src/ui/hub/${file}`)).join("\n");

    expect(sources.match(/<button/g)).toHaveLength(2);
    expect(sources.match(/<button[^>]*className="[^"]*\btap\b/g)).toHaveLength(2);
    expect(sources).toMatch(/<a\s[^>]*className="hub-nav__item tap"/);
  });

  it("uses the icon token for every icon and the topbar token for the bar", () => {
    expect(icons.filter((d) => d.selector === ".hub-ico" && (d.prop === "inline-size" || d.prop === "block-size")).map((d) => d.value)).toEqual([
      "var(--size-icon-staff)",
      "var(--size-icon-staff)",
    ]);
  });
});
