// Fixture pages for the layout tests. They are bundled with esbuild and rendered to static HTML by
// e2e/helpers/layout-fixture.ts (Playwright's own JSX transform is for component testing and does not
// produce React elements). Inline styles here size the test frames only; src/ never uses them.
import { Grid, Inline, Screen, Stack, type GridTwoColumn, type InlineGap, type StackGap } from "@/ui";

export type Labels = { sentences: string[]; words: string[] };

function LabelList({ labels }: { labels: Labels }) {
  return (
    <Stack gap="stack">
      {[...labels.words, ...labels.sentences].map((text) => (
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

export function ActionsScreen() {
  return (
    <main>
      <Screen
        surface="staff"
        actions={
          <Inline gap="target">
            <button className="tap">Approve</button>
            <button className="tap">Return to author</button>
          </Inline>
        }
        actionsLabel="Approval actions"
      >
        {Array.from({ length: 24 }, (_, index) => (
          <Stack gap="label" key={index}>
            <label htmlFor={`field-${index}`}>Field {index + 1}</label>
            <input id={`field-${index}`} data-testid={`field-${index}`} style={{ blockSize: 44 }} />
          </Stack>
        ))}
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
export function TwoColumnPage({ variant, labels, width }: { variant: GridTwoColumn; labels: Labels; width?: number }) {
  return (
    <div style={width ? { inlineSize: `calc(${width}px + 2 * var(--inset-page-staff))` } : undefined}>
      <Screen surface="staff" width="review" actions={<button className="tap">Approve</button>} actionsLabel="Approval">
        <Grid twoColumn={variant} testId="grid">
          <Stack gap="section-hub" testId="main">
            <h1>Main column</h1>
            <LabelList labels={labels} />
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

// A stand-in for the Hub shell (S01.09): a 240px side navigation beside the main area, hidden below
// the 700px shell breakpoint. Its CSS is SHELL_CSS in the specs.
export function ShellPage({ variant, labels }: { variant: GridTwoColumn; labels: Labels }) {
  return (
    <div className="shell">
      <nav>Side navigation</nav>
      <main>
        <TwoColumnPage variant={variant} labels={labels} />
      </main>
    </div>
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
