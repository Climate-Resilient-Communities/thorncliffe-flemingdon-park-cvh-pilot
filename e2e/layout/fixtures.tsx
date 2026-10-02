// Fixture pages for the layout tests. They are bundled with esbuild and rendered to static HTML by
// e2e/helpers/layout-fixture.ts (Playwright's own JSX transform is for component testing and does not
// produce React elements). Inline styles here size the test frames only; src/ never uses them.
import { Grid, Inline, Screen, Stack, type GridTwoColumn, type InlineGap, type StackGap } from "@/ui";
import { HubShell } from "@/ui/hub/hub-shell";
import type { HubNavSection } from "@/ui/hub/hub-nav";
import { ProviderList, type ProviderListLabels, type ProviderRowData } from "@/app/staff/providers/ProviderList";

export type Labels = { sentences: string[]; words: string[]; unbreakable: string };

function LabelList({ labels }: { labels: Labels }) {
  return (
    <Stack gap="stack">
      {[labels.unbreakable, ...labels.words, ...labels.sentences].map((text) => (
        <p key={text}>{text}</p>
      ))}
    </Stack>
  );
}

const Box = ({ testId, label }: { testId: string; label?: string }) => (
  <div data-testid={testId} style={{ blockSize: 40, background: "#ddd" }}>
    {label ?? testId}
  </div>
);

export function ResidentScreen() {
  return (
    <main data-testid="main">
      <Screen surface="resident" testId="screen">
        <Box testId="section-1" />
        <div data-testid="section-2" style={{ inlineSize: "40%", blockSize: 40, background: "#ddd" }} />
        <Box testId="section-3" />
      </Screen>
    </main>
  );
}

export function StaffScreen({ width }: { width?: "default" | "review" | "published" | "log" | "update" | "resolve" | "partner" }) {
  return (
    <main data-testid="main">
      <Screen surface="staff" width={width} testId="screen">
        <Box testId="section-1" />
        <Box testId="section-2" />
        <Box testId="section-3" />
      </Screen>
    </main>
  );
}

const approvalActions = (
  <Inline gap="target">
    <button className="tap" data-testid="first-action">
      Approve
    </button>
    <button className="tap">Return to author</button>
  </Inline>
);

// Positioned fields (z-index auto) stand in for page content that must never paint over the actions region.
const actionFields = Array.from({ length: 24 }, (_, index) => (
  <Stack gap="label" key={index}>
    <label htmlFor={`field-${index}`}>Field {index + 1}</label>
    <input id={`field-${index}`} data-testid={`field-${index}`} style={{ blockSize: 44, position: "relative", zIndex: 1, background: "transparent" }} />
  </Stack>
));

export function ActionsScreen() {
  return (
    <main>
      <Screen surface="staff" actions={approvalActions} actionsLabel="Approval actions">
        {actionFields}
      </Screen>
    </main>
  );
}

export function ResidentActionsScreen() {
  return (
    <main>
      <Screen surface="resident" actions={approvalActions} actionsLabel="Approval actions">
        {actionFields}
      </Screen>
    </main>
  );
}

export function MapScreen() {
  return (
    <main data-testid="main">
      <Screen surface="resident" inset="none" bleed={<div data-testid="map" style={{ blockSize: 200, background: "#9cf" }} />}>
        <Box testId="list" />
      </Screen>
    </main>
  );
}

export function StackFixture({ gap = "stack", align = "stretch" }: { gap?: StackGap; align?: "stretch" | "start" | "center" | "end" }) {
  return (
    <Screen surface="resident">
      <Stack gap={gap} align={align} testId="stack">
        {["One", "Two", "Three"].map((label) => (
          <div key={label} data-testid={`child-${label}`} style={{ background: "#ddd" }}>
            {label}
          </div>
        ))}
      </Stack>
    </Screen>
  );
}

export function StackList() {
  return (
    <Stack as="ul" gap="stack" testId="stack">
      <li>Heat alert</li>
      <li>Flood alert</li>
      <li>Food bank hours</li>
    </Stack>
  );
}

export function IconLabel() {
  return (
    <Screen surface="resident">
      <Inline gap="icon" testId="inline">
        <svg data-testid="icon" width="24" height="24" aria-hidden="true">
          <rect width="24" height="24" />
        </svg>
        <span data-testid="label">Label</span>
      </Inline>
    </Screen>
  );
}

export function Chips({ labels, gap }: { labels: string[]; gap: InlineGap }) {
  return (
    <Screen surface="resident">
      <Inline gap={gap} as="ul" testId="inline">
        {labels.map((label) => (
          <li key={label}>
            <button className="tap">{label}</button>
          </li>
        ))}
      </Inline>
    </Screen>
  );
}

export function Header() {
  return (
    <Screen surface="resident">
      <Inline justify="between" testId="inline">
        <span data-testid="logo">CVH</span>
        <button className="tap" data-testid="language">
          Language
        </button>
      </Inline>
    </Screen>
  );
}

export function GrowTitle({ title }: { title: string }) {
  return (
    <Screen surface="resident">
      <Inline wrap={false} testId="inline">
        <Inline.Grow>
          <h1 data-testid="title">{title}</h1>
        </Inline.Grow>
        <button className="tap" data-testid="button" aria-label="Close">
          ×
        </button>
      </Inline>
    </Screen>
  );
}

export function Tiles() {
  return (
    <Screen surface="resident">
      <Grid cols={2} gap="grid" as="ul" testId="grid">
        {["Food", "Cooling", "Health", "Money"].map((label) => (
          <li key={label}>
            <a href={`#${label}`}>{label}</a>
          </li>
        ))}
      </Grid>
    </Screen>
  );
}

export function MarkButtons() {
  return (
    <Screen surface="resident">
      <Grid cols={3} gap="target" collapseInBasic={false} testId="grid">
        {["Done", "Not reached", "Needs help"].map((label) => (
          <button key={label} className="tap">
            {label}
          </button>
        ))}
      </Grid>
    </Screen>
  );
}

/** A staff Screen; with `width`, framed so that its hub-page content box is exactly that many px. */
export function TwoColumnPage({ variant, labels, width, tall }: { variant: GridTwoColumn; labels: Labels; width?: number; tall?: boolean }) {
  return (
    <div style={width ? { inlineSize: `calc(${width}px + 2 * var(--inset-page-staff))` } : undefined}>
      <Screen surface="staff" width="review" actions={<button className="tap">Approve</button>} actionsLabel="Approval">
        <Grid twoColumn={variant} testId="grid">
          <Stack gap="section-hub" testId="main">
            <h1>Main column</h1>
            <LabelList labels={labels} />
            {tall && <div style={{ blockSize: 1200, background: "#eee" }}>A long main column</div>}
          </Stack>
          <Stack gap="stack" testId="aside">
            <h2>Aside</h2>
            <LabelList labels={labels} />
          </Stack>
        </Grid>
      </Screen>
    </div>
  );
}

// The real Hub shell (S01.09) around a two-column page: the side navigation shows from the Hub breakpoint.
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
export function ShellPage({ variant, labels }: { variant: GridTwoColumn; labels: Labels }) {
  return (
    <HubShell
      user={{ displayName: "Priya Sharma", role: "coordinator" }}
      navigation={[{ id: "main", label: "Hub", items: [{ id: "incidents", label: "Incidents", href: "/staff", exact: true, icon: "now" }] }]}
      currentPath="/staff"
      labels={{
        appName: "Hub and partner space",
        menu: "Menu",
        closeMenu: "Close menu",
        signedInAs: "Signed in as {name}, {role}",
        roles: { ambassador: "Ambassador", coordinator: "Coordinator", director: "Director", admin: "Admin" },
        logoAlt: "Thorncliffe Park Community Hub",
      }}
      signOut={<button className="tap">Sign out</button>}
      brand={{ logoSrc: BLANK_IMAGE, symbolSrc: BLANK_IMAGE }}
    >
      <TwoColumnPage variant={variant} labels={labels} />
    </HubShell>
  );
}

export function TapTargets() {
  return (
    <Screen surface="resident">
      <Inline gap="target">
        <button className="tap" data-testid="icon-button" aria-label="Close">
          ×
        </button>
        <a className="tap" href="#more" data-testid="link">
          More
        </a>
      </Inline>
    </Screen>
  );
}

const TypeSample = () => (
  <>
    <p data-role="body" className="text-body">
      Body text
    </p>
    <h2 data-role="tight" className="text-h2">
      Heading
    </h2>
  </>
);

// Screen's props are a union on the surface, so a surface chosen at run time is written out.
const OnSurface = ({ surface, children }: { surface: "resident" | "staff"; children: import("react").ReactNode }) =>
  surface === "staff" ? <Screen surface="staff">{children}</Screen> : <Screen surface="resident">{children}</Screen>;

/** A lang subtree for each tag inside one Screen (the page's own language is the mount option). */
export function LangProbes({ surface, tags }: { surface: "resident" | "staff"; tags: string[] }) {
  return (
    <OnSurface surface={surface}>
      {tags.map((tag) => (
        <div key={tag} lang={tag}>
          <TypeSample />
        </div>
      ))}
    </OnSurface>
  );
}

/** The lang element contains the Screen, so the staff surface sits inside the language subtree. */
export function LangAroundScreen({ tag, surface }: { tag: string; surface: "resident" | "staff" }) {
  return (
    <div lang={tag}>
      <OnSurface surface={surface}>
        <TypeSample />
      </OnSurface>
    </div>
  );
}

/** Text outside any Screen: the page's own language and surface apply. */
export function PlainText() {
  return <TypeSample />;
}

/** A staff Screen whose text is in the page's own language. */
export function StaffTypePage() {
  return (
    <Screen surface="staff">
      <TypeSample />
    </Screen>
  );
}

/** Text items (not targets) in an Inline: the row and column gaps of meta-inline and type-grid-inline. */
export function TextRow({ gap, items }: { gap: "meta-inline" | "type-grid-inline"; items: string[] }) {
  return (
    <Screen surface="resident">
      <Inline gap={gap} as="ul" testId="inline">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </Inline>
    </Screen>
  );
}

/** Three short links in a 3-column grid at a narrow width: ordinary words must not be split. */
export function FinancialGrid() {
  return (
    <Screen surface="resident">
      <Grid cols={3} testId="grid">
        {["Financial help", "Food support", "Housing advice"].map((label) => (
          <p key={label}>{label}</p>
        ))}
      </Grid>
    </Screen>
  );
}

/** A link inside running text (exempt) and a standalone small link (not exempt). */
export function InlineTextLinks() {
  return (
    <Screen surface="resident">
      <p data-tap-exempt="inline-text">
        Read the <a href="#guide">heat guide</a> before you go out.
      </p>
      <a href="#standalone" data-testid="standalone">
        More
      </a>
    </Screen>
  );
}

/** Unclassed elements: the base layer alone styles them. */
export function BareText({ surface }: { surface?: "staff" }) {
  const content = (
    <>
      <h1>Heading one</h1>
      <h2>Heading two</h2>
      <h3>Heading three</h3>
      <p>Plain paragraph</p>
    </>
  );
  return surface === "staff" ? <Screen surface="staff">{content}</Screen> : content;
}

// ---- The Hub shell (S01.09) -------------------------------------------------------------------

export type HubShellTexts = {
  appName: string;
  menu: string;
  closeMenu: string;
  /** With {name} and {role}. */
  signedInAs: string;
  role: string;
  personName: string;
  signOut: string;
  logoAlt: string;
  /**
   * The navigation, as the pilot's menu is for an Admin: the real hubNavigation("admin") with its ids, hrefs and
   * icons (e2e/helpers/hub-shell.ts), and the labels of the language under test. The fixture invents none of it.
   */
  navigation: readonly HubNavSection[];
  heading: string;
  paragraphs: string[];
};

/**
 * The Hub shell with a staff Screen inside it, signed in as an Admin (who sees every item the pilot's menu has). The
 * menu and the words are the app's own, passed in as texts: hubNavigation("admin") and hubShellLabels() for the real
 * English, the same structure with the longest translated labels for the language tests. The fixture only lays them out.
 */
export function HubShellFixture({
  texts,
  brand,
  signedIn = true,
  current = "/staff",
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  signedIn?: boolean;
  current?: string | null;
}) {
  return (
    <HubShell
      user={signedIn ? { displayName: texts.personName, role: "admin" } : null}
      navigation={texts.navigation}
      currentPath={current}
      labels={{
        appName: texts.appName,
        menu: texts.menu,
        closeMenu: texts.closeMenu,
        signedInAs: texts.signedInAs,
        roles: { ambassador: texts.role, coordinator: texts.role, director: texts.role, admin: texts.role },
        logoAlt: texts.logoAlt,
      }}
      signOut={
        <form method="post" action="/api/staff/sign-out">
          <button type="submit" className="tap">
            {texts.signOut}
          </button>
        </form>
      }
      brand={brand}
    >
      <Screen surface="staff" testId="screen">
        <Stack gap="related">
          <h1>{texts.heading}</h1>
          {texts.paragraphs.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </Stack>
      </Screen>
    </HubShell>
  );
}

/**
 * The Hub shell around the Providers screen (S02.04), as an Admin sees it: the real ProviderList with the rows and
 * words the page gives it. Its actions are the harness's stand-ins (e2e/helpers/provider-actions-stub.ts).
 */
export function ProvidersFixture({
  texts,
  brand,
  rows,
  labels,
  today,
  summary,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  rows: ProviderRowData[];
  labels: ProviderListLabels;
  today: string;
  summary: string;
}) {
  return (
    <HubShell
      user={{ displayName: texts.personName, role: "admin" }}
      navigation={texts.navigation}
      currentPath="/staff/providers"
      labels={{
        appName: texts.appName,
        menu: texts.menu,
        closeMenu: texts.closeMenu,
        signedInAs: texts.signedInAs,
        roles: { ambassador: texts.role, coordinator: texts.role, director: texts.role, admin: texts.role },
        logoAlt: texts.logoAlt,
      }}
      signOut={
        <form method="post" action="/api/staff/sign-out">
          <button type="submit" className="tap">
            {texts.signOut}
          </button>
        </form>
      }
      brand={brand}
    >
      <Screen surface="staff" testId="screen">
        <Stack gap="section-hub">
          <Stack gap="related">
            <h1>{texts.heading}</h1>
            {texts.paragraphs.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </Stack>
          <p>{summary}</p>
          <ProviderList rows={rows} today={today} labels={labels} />
        </Stack>
      </Screen>
    </HubShell>
  );
}
