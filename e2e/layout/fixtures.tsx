// Fixture pages for the layout tests. They are bundled with esbuild and rendered to static HTML by
// e2e/helpers/layout-fixture.ts (Playwright's own JSX transform is for component testing and does not
// produce React elements). Inline styles here size the test frames only; src/ never uses them.
import { Grid, Inline, Screen, Stack, type GridTwoColumn, type InlineGap, type StackGap } from "@/ui";
import { HubShell } from "@/ui/hub/hub-shell";
import type { HubNavSection } from "@/ui/hub/hub-nav";
import { DirectoryRelease, type DirectoryReleaseView } from "@/app/staff/directory/DirectoryRelease";
import { PauseBanner } from "@/app/staff/PauseBanner";
import { HealthBanner } from "@/app/staff/HealthBanner";
import type { HealthBannerView } from "@/app/staff/healthBannerModel";
import { OncallFormsView } from "@/app/staff/oncall/OncallFormsView";
import { OncallView } from "@/app/staff/oncall/OncallView";
import { CapFormView } from "@/app/staff/spend/CapFormView";
import { SpendBody } from "@/app/staff/spend/SpendBody";
import type { SpendScreen } from "@/app/staff/spend/view";
import { DrillsView } from "@/app/staff/drills/DrillsView";
import { SignupFormView } from "@/app/staff/text-signup/SignupFormView";
import { TextSignupView, type TextSignupModel } from "@/app/staff/text-signup/TextSignupView";
import { ProblemListBody, SendingBody } from "@/app/staff/alerts/sending/SendingBody";
import type { ResendState } from "@/app/staff/alerts/sending/texts/control";
import { ResendAllFormView, ResendOneFormView } from "@/app/staff/alerts/sending/texts/ResendFormView";
import type { DrillsView as DrillsModel } from "@/app/staff/drills/view";
import { RosterFormsView } from "@/app/staff/drills/roster/RosterFormsView";
import { RosterView } from "@/app/staff/drills/roster/RosterView";
import type { PauseBannerView } from "@/app/staff/pauseBanner";
import { PauseTextsFormView } from "@/app/staff/texts/PauseTextsFormView";
import { TextsView } from "@/app/staff/texts/TextsView";
import type { PausedView } from "@/app/staff/texts/view";
import { MeasuresView } from "@/app/staff/measures/MeasuresView";
import type { MeasuresView as MeasuresModel } from "@/app/staff/measures/view";
import type { ComponentProps, ReactNode } from "react";
import { AuthenticatorCodeForm } from "@/app/staff/AuthenticatorCodeForm";
import { SignOutButton } from "@/app/staff/SignOutButton";
import { SignInForm } from "@/app/staff/sign-in/SignInForm";
import { ChoosePasswordForm } from "@/app/staff/setup/password/ChoosePasswordForm";
import { EnrolAuthenticator } from "@/app/staff/setup/authenticator/EnrolAuthenticator";
import { AddPersonForm, type AddPersonLabels } from "@/app/staff/people/AddPersonForm";
import { ReissueForm } from "@/app/staff/people/ReissueForm";
import { ResetAuthenticatorForm } from "@/app/staff/people/ResetAuthenticatorForm";
import { ResetPasswordForm } from "@/app/staff/people/ResetPasswordForm";
import type { AddPersonState } from "@/app/staff/people/addPerson";
import type { ReissueState } from "@/app/staff/people/reissue";
import type { ResetAuthenticatorState } from "@/app/staff/people/resetAuthenticator";
import type { ResetPasswordState } from "@/app/staff/people/resetPassword";
import { englishText } from "@/i18n/text";
import { BuildingsBody, type BuildingActions, type BuildingsInitial } from "@/app/staff/buildings/BuildingsBody";
import type { BuildingsScreen } from "@/app/staff/buildings/view";
import { AudienceBody, type AudienceActions, type AudienceInitial } from "@/app/staff/alerts/audience/AudienceBody";
import type { AudienceScreen } from "@/app/staff/alerts/audience/view";
import { IncidentsList } from "@/app/staff/alerts/incidents/IncidentsList";
import type { IncidentsView } from "@/app/staff/alerts/incidents/view";
import { AmbassadorHomeBody } from "@/app/staff/ambassador/AmbassadorHomeBody";
import { PostForm, type PostInitial } from "@/app/staff/ambassador/post/PostForm";
import type { PostScreen } from "@/app/staff/ambassador/post/view";
import type { FollowInitial } from "@/app/staff/ambassador/status/FollowForms";
import { ResolveBody, StatusBody } from "@/app/staff/ambassador/status/StatusBody";
import type { ResolveScreen, StatusScreen } from "@/app/staff/ambassador/status/view";
import type { AmbassadorHomeView } from "@/app/staff/ambassador/view";
import { ApprovalBody, type ApprovalActions, type ApprovalInitial } from "@/app/staff/alerts/approval/ApprovalBody";
import type { ApprovalScreen } from "@/app/staff/alerts/approval/view";
import { ComposerBody, type ComposerActions, type ComposerInitial } from "@/app/staff/alerts/composer/ComposerBody";
import type { ComposerScreen } from "@/app/staff/alerts/composer/view";
import type { SubmitApi } from "@/app/staff/alerts/composer/submitClient";
import { LogBody } from "@/app/staff/alerts/log/LogBody";
import type { LogState } from "@/app/staff/alerts/log/logDisruption";
import type { LogScreen } from "@/app/staff/alerts/log/view";
import { CoverageBody, type CoverageActions, type CoverageInitial } from "@/app/staff/coverage/CoverageBody";
import type { CoverageScreen } from "@/app/staff/coverage/view";
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
    <AroundTheScreen texts={texts} brand={brand} signedIn={signedIn} current={current}>
      <Screen surface="staff" testId="screen">
        <Stack gap="related">
          <h1>{texts.heading}</h1>
          {texts.paragraphs.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </Stack>
      </Screen>
    </AroundTheScreen>
  );
}

/** The Hub shell around a screen, signed in as an Admin (or signed out, with no person and no menu). */
function AroundTheScreen({
  texts,
  brand,
  signedIn,
  current,
  children,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  signedIn: boolean;
  current: string | null;
  children: ReactNode;
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
          <button type="submit" className="hub-button hub-button--secondary">
            {texts.signOut}
          </button>
        </form>
      }
      brand={brand}
    >
      {children}
    </HubShell>
  );
}

const noAction = async () => ({ status: "idle" as const });

/**
 * The buildings screen (S01.13) as an Admin sees it in the Hub shell: the app's own BuildingsBody on a view built by
 * the app's own view functions (e2e/hub/buildings.spec.ts), with the actions replaced by ones that do nothing and,
 * where a picture needs it, a form already in its refused state (`initial`).
 */
export function BuildingsFixture({
  texts,
  brand,
  screen,
  initial,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  screen: BuildingsScreen;
  initial?: BuildingsInitial;
}) {
  const actions: BuildingActions = { add: noAction, rename: noAction, remove: noAction, confirm: noAction, contact: noAction };
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff/buildings">
      <Screen surface="staff" testId="screen">
        <BuildingsBody screen={screen} actions={actions} initial={initial} />
      </Screen>
    </AroundTheScreen>
  );
}

/**
 * The coverage screen (S01.14) as an Admin, a Coordinator or a Director sees it in the Hub shell: the app's own CoverageBody on a
 * view built by the app's own view functions (e2e/hub/coverage.spec.ts), with the actions replaced by ones that do nothing
 * and, where a picture needs it, a form already in its refused state (`initial`).
 */
export function CoverageFixture({
  texts,
  brand,
  screen,
  initial,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  screen: CoverageScreen;
  initial?: CoverageInitial;
}) {
  const actions: CoverageActions = { assign: noAction, remove: noAction };
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff/coverage">
      <Screen surface="staff" testId="screen">
        <CoverageBody screen={screen} actions={actions} initial={initial} />
      </Screen>
    </AroundTheScreen>
  );
}

/**
 * The audience pages (S04.04, O-03 the place and O-04 the groups) as a Coordinator sees them in the Hub shell: the app's own
 * AudienceBody on a view built by the app's own view functions (e2e/hub/audience.spec.ts and e2e/layout/audience.spec.ts), in
 * the same `review` Screen the pages use, with the actions replaced by ones that do nothing and, where a picture needs it, a
 * form already in its refused state (`initial`).
 */
export function AudienceFixture({
  texts,
  brand,
  screen,
  initial,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  screen: AudienceScreen;
  initial?: AudienceInitial;
}) {
  const actions: AudienceActions = { place: noAction, groups: noAction };
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff/alerts/audience">
      <Screen surface="staff" width="review" testId="screen">
        <AudienceBody screen={screen} actions={actions} initial={initial} />
      </Screen>
    </AroundTheScreen>
  );
}

/**
 * "Log a disruption" (S04.05, O-11) as a Coordinator sees it in the Hub shell: the app's own LogBody on a view built by the app's own
 * view function, in the `log` Screen the page uses, with an action that does nothing and, where a picture needs it, a form already in
 * its refused state (`initialState`).
 */
export function LogFixture({
  texts,
  brand,
  screen,
  initialState,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  screen: LogScreen;
  initialState?: LogState;
}) {
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff/alerts/log">
      <Screen surface="staff" width="log" testId="screen">
        <LogBody screen={screen} action={noAction} initialState={initialState} />
      </Screen>
    </AroundTheScreen>
  );
}

/**
 * The acknowledgement composer (O-12) and the alert composer (O-02, S04.05) as a Coordinator sees them in the Hub shell: the app's own
 * ComposerBody on a view built by the app's own view function. The body draws its own Screen (with the sticky actions region), so
 * the fixture adds only the shell. Its actions do nothing and its calls to the server are the `api` the test gives it.
 */
export function ComposerFixture({
  texts,
  brand,
  screen,
  initial,
  api,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  screen: ComposerScreen;
  initial?: ComposerInitial;
  api?: SubmitApi;
}) {
  const actions: ComposerActions = { save: noAction, pullBack: noAction, start: noAction };
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current={{ ack: "/staff/alerts/ack", compose: "/staff/alerts/compose", update: "/staff/alerts/update", promote: "/staff/alerts/promote", correct: "/staff/alerts/correct", withdraw: "/staff/alerts/withdraw", resolve: "/staff/alerts/resolve" }[screen.from]}>
      <ComposerBody screen={screen} actions={actions} initial={initial} api={api} reload={() => {}} />
    </AroundTheScreen>
  );
}

/**
 * The approval view (S04.07; O-05 an alert, O-07 an ambassador's post) as a Coordinator sees it in the Hub shell: the app's own ApprovalBody on a view
 * built by the app's own view function (e2e/layout/approval.spec.ts), with actions that do nothing, optionally already in the state a press reaches
 * (`initial`: the return form, the discard confirmation, a count that changed).
 */
export function ApprovalFixture({
  texts,
  brand,
  screen,
  initial,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  screen: ApprovalScreen;
  initial?: ApprovalInitial;
}) {
  const actions: ApprovalActions = { approve: noAction, returnToAuthor: noAction, discard: noAction };
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff/alerts/approve">
      <ApprovalBody screen={screen} actions={actions} initial={initial} />
    </AroundTheScreen>
  );
}

/** The Hub home's list of what waits for a person (S04.07) inside the Hub shell, on the view the app's own function built. */
export function IncidentsFixture({ texts, brand, view }: { texts: HubShellTexts; brand: { logoSrc: string; symbolSrc: string }; view: IncidentsView }) {
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff">
      <Screen surface="staff" testId="screen">
        <IncidentsList view={view} />
      </Screen>
    </AroundTheScreen>
  );
}

/** The Ambassador's home (A-01, S08.01) inside the Hub shell, on the view the app's own function built. */
export function AmbassadorHomeFixture({ texts, brand, view }: { texts: HubShellTexts; brand: { logoSrc: string; symbolSrc: string }; view: AmbassadorHomeView }) {
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff">
      <Screen surface="staff" testId="screen">
        <AmbassadorHomeBody view={view} />
      </Screen>
    </AroundTheScreen>
  );
}

/** An ambassador's post (A-02, S08.02) inside the Hub shell, on the view the app's own function built, in the state `initial` gives; nothing is ever sent. */
export function AmbassadorPostFixture({ texts, brand, screen, initial }: { texts: HubShellTexts; brand: { logoSrc: string; symbolSrc: string }; screen: PostScreen; initial?: PostInitial }) {
  const quiet = () => ({ press: () => undefined, state: () => ({ kind: "idle" as const }), stop: () => undefined });
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff">
      <Screen surface="staff" testId="screen">
        <PostForm screen={screen} sender={quiet} initial={initial} />
      </Screen>
    </AroundTheScreen>
  );
}

/** Where an ambassador's post stands (A-03, S08.04) inside the Hub shell, on the view the app's own function built, with the forms in the state `followInitial` gives; nothing is ever sent. */
export function AmbassadorStatusFixture({ texts, brand, screen, followInitial }: { texts: HubShellTexts; brand: { logoSrc: string; symbolSrc: string }; screen: StatusScreen; followInitial?: FollowInitial }) {
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff">
      <Screen surface="staff" testId="screen">
        <StatusBody screen={screen} followInitial={followInitial} />
      </Screen>
    </AroundTheScreen>
  );
}

/** "Mark resolved" (S08.04) inside the Hub shell, on the view the app's own function built. */
export function AmbassadorResolveFixture({ texts, brand, screen, followInitial }: { texts: HubShellTexts; brand: { logoSrc: string; symbolSrc: string }; screen: ResolveScreen; followInitial?: FollowInitial }) {
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff">
      <Screen surface="staff" testId="screen">
        <ResolveBody screen={screen} followInitial={followInitial} />
      </Screen>
    </AroundTheScreen>
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
          <button type="submit" className="hub-button hub-button--secondary">
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

/**
 * The Hub shell around the Pause texts screen (S06.06), as an Admin sees it: the real body (TextsView) and the real, behaviour-free
 * controls (PauseTextsFormView) with the state a press would leave, and, while texts are paused, the banner the Hub layout puts above
 * every Hub screen (PauseBanner), here above this one. Nothing here is a phone number.
 */
export function TextsFixture({
  texts,
  brand,
  paused,
  unreadable,
  form,
  banner,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  paused: PausedView | null;
  unreadable?: boolean;
  form: ComponentProps<typeof PauseTextsFormView>;
  banner?: PauseBannerView;
}) {
  return (
    <HubShell
      user={{ displayName: texts.personName, role: "admin" }}
      navigation={texts.navigation}
      currentPath="/staff/texts"
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
          <button type="submit" className="hub-button hub-button--secondary">
            {texts.signOut}
          </button>
        </form>
      }
      brand={brand}
    >
      {banner ? <PauseBanner view={banner} /> : null}
      <Screen surface="staff" testId="screen">
        <TextsView paused={paused} unreadable={unreadable} form={<PauseTextsFormView {...form} />} />
      </Screen>
    </HubShell>
  );
}

/**
 * The Hub shell around the pilot measures page (S07.10): the real, read-only body (MeasuresView) with the view model a Director (the cost of each alert
 * included), a Coordinator (no cost, AD-4), or either before anything is counted would be given. Counts, languages and amounts: nothing here is a phone number.
 */
export function MeasuresFixture({ texts, brand, view, role = "director" }: { texts: HubShellTexts; brand: { logoSrc: string; symbolSrc: string }; view: MeasuresModel; role?: "director" | "coordinator" | "admin" }) {
  return (
    <HubShell
      user={{ displayName: texts.personName, role }}
      navigation={texts.navigation}
      currentPath="/staff/measures"
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
          <button type="submit" className="hub-button hub-button--secondary">
            {texts.signOut}
          </button>
        </form>
      }
      brand={brand}
    >
      <Screen surface="staff" testId="screen">
        <MeasuresView view={view} />
      </Screen>
    </HubShell>
  );
}

/**
 * The Hub shell around the sending progress of an alert (S06.09), as a Coordinator sees it: the real body of the alert's staff view (SendingBody, drawn without
 * the 15 second reload) or of the list of the texts that did not arrive (ProblemListBody). Counts, languages and meanings only: nothing here is a phone number.
 * With `resend` the list is the Admin's (S09.02): the real, behaviour-free "Resend" forms, each showing `resend.answer` when one is given (the state a press would leave).
 */
export function SendingFixture({
  texts,
  brand,
  screen,
  list,
  resend,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  screen?: ComponentProps<typeof SendingBody>["screen"];
  list?: ComponentProps<typeof ProblemListBody>["screen"];
  resend?: { answer?: ResendState };
}) {
  return (
    <HubShell
      user={{ displayName: texts.personName, role: "coordinator" }}
      navigation={texts.navigation}
      currentPath="/staff"
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
          <button type="submit" className="hub-button hub-button--secondary">
            {texts.signOut}
          </button>
        </form>
      }
      brand={brand}
    >
      <Screen surface="staff" width="review" testId="screen">
        {screen ? <SendingBody screen={screen} live={false} /> : null}
        {list ? (
          <ProblemListBody
            screen={list}
            resend={
              resend
                ? {
                    one: (view) => <ResendOneFormView view={view} answer={resend.answer} />,
                    all: (view) => <ResendAllFormView view={view} answer={resend.answer} />,
                  }
                : undefined
            }
          />
        ) : null}
      </Screen>
    </HubShell>
  );
}

/**
 * The Hub shell around the On-call numbers screen (S06.07), as an Admin sees it: the real body (OncallView) and the real, behaviour-free list and
 * forms (OncallFormsView) with the state a press would leave, and, while a health condition holds, the banner the Hub layout puts above every Hub
 * screen (HealthBanner, S06.07 and S09.01), here above this one. Every number is a fictional one masked to its last four digits.
 */
export function OncallFixture({
  texts,
  brand,
  count,
  unreadable,
  form,
  banner,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  count: number;
  unreadable?: boolean;
  form: ComponentProps<typeof OncallFormsView>;
  banner?: HealthBannerView;
}) {
  return (
    <HubShell
      user={{ displayName: texts.personName, role: "admin" }}
      navigation={texts.navigation}
      currentPath="/staff/oncall"
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
          <button type="submit" className="hub-button hub-button--secondary">
            {texts.signOut}
          </button>
        </form>
      }
      brand={brand}
    >
      {banner ? <HealthBanner view={banner} /> : null}
      <Screen surface="staff" testId="screen">
        <OncallView count={count} unreadable={unreadable} forms={<OncallFormsView {...form} />} />
      </Screen>
    </HubShell>
  );
}

/**
 * The Hub shell around the Spend screen (S07.08), as an Admin sees it (with the cap form) or a Director (read-only: the note in its place): the real body
 * (SpendBody) on a screen built by the app's own view function (e2e/hub/spend.spec.ts), and the real, behaviour-free cap form (CapFormView) with the state a
 * press would leave. Every figure is fictional.
 */
export function SpendFixture({
  texts,
  brand,
  role,
  screen,
  unreadable,
  form,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  role: "admin" | "director";
  screen: SpendScreen | null;
  unreadable?: boolean;
  form: ComponentProps<typeof CapFormView>;
}) {
  return (
    <HubShell
      user={{ displayName: texts.personName, role }}
      navigation={texts.navigation}
      currentPath="/staff/spend"
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
          <button type="submit" className="hub-button hub-button--secondary">
            {texts.signOut}
          </button>
        </form>
      }
      brand={brand}
    >
      <Screen surface="staff" testId="screen">
        <SpendBody
          screen={screen}
          unreadable={unreadable}
          form={role === "admin" ? <CapFormView {...form} /> : <p data-testid="cap-read-only">{englishText("staff.spend.cap.readOnly")}</p>}
        />
      </Screen>
    </HubShell>
  );
}

/**
 * The Hub shell around the Drills screen (S06.05), as an Admin sees it: the real body (DrillsView) on a view built by the app's own view functions
 * (e2e/hub/drills.spec.ts), with a fictional roster and counts.
 */
export function DrillsFixture({ texts, brand, view }: { texts: HubShellTexts; brand: { logoSrc: string; symbolSrc: string }; view: DrillsModel }) {
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff/drills">
      <Screen surface="staff" testId="screen">
        <DrillsView view={view} />
      </Screen>
    </AroundTheScreen>
  );
}

/**
 * The Hub shell around the drill roster screen (S06.05), as an Admin sees it: the real body (RosterView) and the real, behaviour-free list and forms
 * (RosterFormsView) with the state a press would leave. Every number is a fictional one masked to its last four digits.
 */
export function DrillRosterFixture({
  texts,
  brand,
  count,
  unreadable,
  form,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  count: number;
  unreadable?: boolean;
  form: ComponentProps<typeof RosterFormsView>;
}) {
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff/drills/roster">
      <Screen surface="staff" testId="screen">
        <RosterView count={count} unreadable={unreadable} forms={<RosterFormsView {...form} />} />
      </Screen>
    </AroundTheScreen>
  );
}

/**
 * The Hub shell around the Directory release screen (S02.05), as an Admin sees it: the real DirectoryRelease with the
 * words the page gives it. Its action is the harness's stand-in (e2e/helpers/directory-actions-stub.ts).
 */
export function DirectoryFixture({
  texts,
  brand,
  view,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  view: DirectoryReleaseView;
}) {
  return (
    <HubShell
      user={{ displayName: texts.personName, role: "admin" }}
      navigation={texts.navigation}
      currentPath="/staff/directory"
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
          <button type="submit" className="hub-button hub-button--secondary">
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
          <DirectoryRelease view={view} />
        </Stack>
      </Screen>
    </HubShell>
  );
}

// ---- The staff screens made of forms (S01.05, S01.07, S01.08, S01.10, S01.11) -----------------------------------------

/**
 * A staff page outside the Hub shell (sign-in, the authenticator code, the two setup gates): the page's own <main>, heading
 * and lead, and its real form, as the page markup has them. Words are the catalog's. The form posts with fetch, so a
 * screenshot that needs an answer replaces `fetch` in the page first (e2e/hub/staff-forms.spec.ts).
 */
export function StaffGateFixture({ page }: { page: "sign-in" | "code" | "password" | "authenticator" }) {
  const signOut = <SignOutButton label={englishText("staff.signOut")} />;
  const unavailable = englishText("staff.authenticator.errors.unavailable");
  const body = {
    "sign-in": (
      <>
        <Stack gap="related">
          <h1>{englishText("staff.signIn.title")}</h1>
          <p>{englishText("staff.signIn.lead")}</p>
        </Stack>
        <SignInForm
          labels={{
            username: englishText("staff.signIn.username"),
            password: englishText("staff.signIn.password"),
            submit: englishText("staff.signIn.submit"),
            unavailable: englishText("staff.signIn.unavailable"),
          }}
        />
      </>
    ),
    code: (
      <>
        <Stack gap="related">
          <h1>{englishText("staff.authenticator.code.title")}</h1>
          <p>{englishText("staff.authenticator.code.lead")}</p>
        </Stack>
        <AuthenticatorCodeForm
          labels={{ code: englishText("staff.authenticator.code.code"), submit: englishText("staff.authenticator.code.submit"), unavailable }}
        />
        <p>{englishText("staff.authenticator.code.lost")}</p>
        {signOut}
      </>
    ),
    password: (
      <>
        <Stack gap="related">
          <h1>{englishText("staff.setup.password.title")}</h1>
          <p>{englishText("staff.setup.password.lead")}</p>
        </Stack>
        <ChoosePasswordForm
          labels={{
            password: englishText("staff.setup.password.password"),
            passwordHint: englishText("staff.setup.password.passwordHint"),
            confirm: englishText("staff.setup.password.confirm"),
            submit: englishText("staff.setup.password.submit"),
            unavailable: englishText("staff.setup.password.errors.unavailable"),
          }}
        />
        {signOut}
      </>
    ),
    authenticator: (
      <>
        <Stack gap="related">
          <h1>{englishText("staff.setup.authenticator.title")}</h1>
          <p>{englishText("staff.setup.authenticator.lead")}</p>
          <p>{englishText("staff.setup.authenticator.install")}</p>
        </Stack>
        <EnrolAuthenticator
          labels={{
            start: englishText("staff.setup.authenticator.start"),
            scan: englishText("staff.setup.authenticator.scan"),
            qrAlt: englishText("staff.setup.authenticator.qrAlt"),
            key: englishText("staff.setup.authenticator.key", { key: "{key}" }),
            keyHint: englishText("staff.setup.authenticator.keyHint"),
            unavailable,
            code: { code: englishText("staff.setup.authenticator.code"), submit: englishText("staff.setup.authenticator.submit"), unavailable },
          }}
        />
        {signOut}
      </>
    ),
  }[page];
  return (
    <main>
      <Screen surface="staff">
        <div className="hub-gate">
          <Stack gap="section-hub">{body}</Stack>
        </div>
      </Screen>
    </main>
  );
}

/**
 * The People screen in the Hub shell, as an Admin sees it: the real forms (add a person, reset password, reset
 * authenticator, re-issue) with the state each starts in. Their actions are the harness's stand-ins
 * (e2e/helpers/people-actions-stub.ts).
 */
export function PeopleFixture({
  texts,
  brand,
  add,
  resetPassword,
  resetAuthenticator,
  reissue,
  refusal,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  add?: AddPersonState;
  resetPassword?: ResetPasswordState;
  resetAuthenticator?: ResetAuthenticatorState;
  reissue?: ReissueState;
  /** Instead of the forms: why this person may not add anyone. */
  refusal?: "forbidden";
}) {
  const roles = (["ambassador", "coordinator", "director", "admin"] as const).map((role) => ({ value: role, label: englishText(`staff.roles.${role}`) }));
  // The browser bundle cannot take AddPersonBody (it reaches the identity module and node:crypto), so its labels are read here.
  const addPersonLabels = Object.fromEntries(
    ["username", "usernameHint", "firstName", "lastName", "nameHint", "email", "emailHint", "role", "submit", "addAnother"].map((key) => [key, englishText(`staff.people.${key}` as "staff.people.username")]),
  ) as unknown as AddPersonLabels;
  const labelsOf = (prefix: "resetPassword" | "resetAuthenticator" | "reissue") => ({
    title: englishText(`staff.${prefix}.title`),
    lead: englishText(`staff.${prefix}.lead`),
    username: englishText(`staff.${prefix}.username`),
    submit: englishText(`staff.${prefix}.submit`),
  });
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff/people">
      <Screen surface="staff" testId="screen">
        <Stack gap="section-hub">
          <Stack gap="related">
            <h1>{texts.heading}</h1>
            {texts.paragraphs.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </Stack>
          {refusal ? (
            <p role="alert" className="hub-error">
              {englishText(`staff.people.errors.${refusal}`)}
            </p>
          ) : (
            <>
              <AddPersonForm labels={addPersonLabels} roles={roles} initialState={add} />
              <ResetPasswordForm labels={labelsOf("resetPassword")} initialState={resetPassword} />
              <ResetAuthenticatorForm labels={labelsOf("resetAuthenticator")} initialState={resetAuthenticator} />
              <ReissueForm labels={labelsOf("reissue")} initialState={reissue} />
            </>
          )}
        </Stack>
      </Screen>
    </AroundTheScreen>
  );
}

/**
 * The Hub shell around the Text sign-up screen (S07.03), as an Admin sees it: the real body (TextSignupView) at each step, and on the form step the
 * real, behaviour-free form (SignupFormView) with the state a press would leave. The terms are the committed ones; every number is fictional.
 */
export function TextSignupFixture({
  texts,
  brand,
  model,
  form,
}: {
  texts: HubShellTexts;
  brand: { logoSrc: string; symbolSrc: string };
  model: TextSignupModel;
  form?: ComponentProps<typeof SignupFormView>;
}) {
  return (
    <AroundTheScreen texts={texts} brand={brand} signedIn current="/staff/text-signup">
      <Screen surface="staff" testId="screen">
        <TextSignupView model={model} form={form ? <SignupFormView {...form} /> : undefined} />
      </Screen>
    </AroundTheScreen>
  );
}
