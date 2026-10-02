import { Grid, Stack } from "@/ui";
import { GroupsForm, PlaceForm, type AudienceAction } from "./AudienceForms";
import type { AudienceState } from "./editAudience";
import type { AsideView, AudienceScreen, StepsView } from "./view";

export interface AudienceActions {
  place: AudienceAction;
  groups: AudienceAction;
}

/** Test seam: forms already in the state they reach after a refusal (the screenshots show them). */
export interface AudienceInitial {
  place?: AudienceState;
  groups?: AudienceState;
}

function Notice({ text }: { text?: string }) {
  return text ? <p role="status">{text}</p> : null;
}

/** The two steps, as links: a full page load, like the Hub's navigation. The current one is marked in words as well as by `aria-current`. */
function Steps({ steps }: { steps: StepsView }) {
  return (
    <nav aria-label={steps.label}>
      <Stack as="ul" gap="label">
        {steps.items.map((step) => (
          <li key={step.id}>
            <a className="tap hub-link" href={step.href} aria-current={step.current ? "step" : undefined}>
              {step.current ? <strong>{step.label}</strong> : step.label}
            </a>
          </li>
        ))}
      </Stack>
    </nav>
  );
}

/** "Who gets it now": the saved audience in words, and the way to the other step. The aside of both pages. */
function Aside({ view }: { view: AsideView }) {
  return (
    <aside aria-labelledby="audience-aside-title" data-testid="audience-aside">
      <Stack gap="stack">
        <h2 id="audience-aside-title">{view.title}</h2>
        <p data-testid="audience-sentence">{view.sentence}</p>
        {view.floorNote && <p>{view.floorNote}</p>}
        <p data-testid="audience-groups">{view.groups}</p>
        <a className="tap hub-link" href={view.link.href}>
          {view.link.label}
        </a>
      </Stack>
    </aside>
  );
}

/**
 * The audience pages' body (O-03 the place, O-04 the groups): the main column with the picker and, after it, the
 * aside with who gets it now. The two-column Grid of the Hub: one column below 800px of content width with the
 * main content first and the aside filling the width, two columns from 800px (components/grid.md). The Screen
 * around it belongs to the page.
 */
export function AudienceBody({ screen, actions, initial }: { screen: AudienceScreen; actions: AudienceActions; initial?: AudienceInitial }) {
  if (screen.kind === "missing") {
    return (
      <Stack gap="related">
        <p role="alert">{screen.message}</p>
        <a className="tap hub-link" href={screen.back.href}>
          {screen.back.label}
        </a>
      </Stack>
    );
  }
  if (screen.kind === "locked") {
    return (
      <Grid twoColumn="aside">
        <Stack gap="section-hub-main">
          <h1>{screen.title}</h1>
          <p role="note" className="hub-flag">
            {screen.message}
          </p>
        </Stack>
        <Aside view={screen.aside} />
      </Grid>
    );
  }
  return (
    <Grid twoColumn="aside">
      <Stack gap="section-hub-main">
        <Stack gap="related">
          <h1>{screen.title}</h1>
          <p>{screen.lead}</p>
          <Notice text={screen.notice} />
          <Steps steps={screen.steps} />
        </Stack>
        {screen.kind === "place" ? (
          <PlaceForm screen={screen} action={actions.place} initialState={initial?.place} />
        ) : (
          <>
            <p data-testid="audience-web-note" role="note" className="hub-flag">
              {screen.webNote}
            </p>
            <GroupsForm screen={screen} action={actions.groups} initialState={initial?.groups} />
          </>
        )}
      </Stack>
      <Aside view={screen.aside} />
    </Grid>
  );
}
