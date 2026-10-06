import { Stack } from "@/ui";
import { AssignForm, RemoveAssignmentForm, type AssignAction } from "./AssignmentForms";
import type { AssignState } from "./editAssignments";
import type { CoverageBuildingView, CoverageListView, CoverageMissingView, CoverageScreen } from "./view";

export interface CoverageActions {
  assign: AssignAction;
  remove: AssignAction;
}

/** Test seam: forms already in the state they reach after a refusal (the screenshots show them). */
export interface CoverageInitial {
  assign?: AssignState;
  /** By staff id. */
  remove?: Record<string, AssignState>;
}

function Notice({ text }: { text?: string }) {
  return text ? <p role="status">{text}</p> : null;
}

function List({ view }: { view: CoverageListView }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <h1>{view.title}</h1>
        <p>{view.lead}</p>
        <p data-testid="coverage-summary">{view.summary}</p>
        {view.requestsSummary && (
          <p role="note" className="hub-flag" data-testid="coverage-requests-summary">
            {view.requestsSummary}
          </p>
        )}
        <Notice text={view.notice} />
      </Stack>
      {view.empty && <p>{view.empty}</p>}
      {view.groups.map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`}>
          <Stack gap="related">
            <h2 id={`group-${group.id}`}>
              {group.name} ({group.items.length})
            </h2>
            <Stack as="ul" gap="related">
              {group.items.map((item) => (
                <li key={item.rsn} className="hub-list-item" data-testid={`coverage-${item.rsn}`}>
                  <Stack gap="subline">
                    {/* A real link: a full page load, like the Hub's navigation. */}
                    <a className="tap hub-link" href={item.href} aria-label={item.linkLabel}>
                      {item.address}
                    </a>
                    <p>{item.summary}</p>
                    {item.covered && (
                      <p className="hub-cover hub-cover--covered">
                        <span className="hub-cover__label">{item.covered.label}</span> {item.covered.floors}
                      </p>
                    )}
                    {item.uncovered && (
                      <p role="note" className="hub-cover hub-cover--uncovered">
                        <span className="hub-cover__label">{item.uncovered.label}</span> {item.uncovered.floors}
                      </p>
                    )}
                    {item.requestsUncovered && (
                      <p role="note" className="hub-flag" data-testid={`coverage-requests-${item.rsn}`}>
                        {item.requestsUncovered}
                      </p>
                    )}
                  </Stack>
                </li>
              ))}
            </Stack>
          </Stack>
        </section>
      ))}
    </Stack>
  );
}

function Building({ view, actions, initial }: { view: CoverageBuildingView; actions: CoverageActions; initial?: CoverageInitial }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <a className="tap hub-link" href={view.back.href}>
          {view.back.label}
        </a>
        <h1>{view.address}</h1>
        <p>
          {view.neighbourhood}. {view.summary}
        </p>
        {view.requestsUncovered && (
          <p role="note" className="hub-flag" data-testid="coverage-requests">
            {view.requestsUncovered}
          </p>
        )}
        <Notice text={view.notice} />
      </Stack>

      <section aria-labelledby="coverage-floors-title">
        <Stack gap="related">
          <h2 id="coverage-floors-title">{view.floors.title}</h2>
          {view.floors.empty && <p>{view.floors.empty}</p>}
          <Stack as="ul" gap="related">
            {view.floors.rows.map((floor) => (
              <li key={floor.id} data-testid={`floor-${floor.id}`} className={`hub-cover ${floor.covered ? "hub-cover--covered" : "hub-cover--uncovered"}`}>
                <span className="hub-cover__label">{floor.label}</span> {floor.state}
              </li>
            ))}
          </Stack>
        </Stack>
      </section>

      <section aria-labelledby="coverage-assignments-title">
        <Stack gap="related">
          <h2 id="coverage-assignments-title">{view.assignments.title}</h2>
          {view.assignments.empty && <p>{view.assignments.empty}</p>}
          <Stack as="ul" gap="related">
            {view.assignments.rows.map((row) => (
              <li key={row.staffId} className="hub-list-item" data-testid={`assignment-${row.staffId}`}>
                <Stack gap="label">
                  <p>
                    <strong>{row.name}</strong>. {row.floors}.
                  </p>
                  {row.inactive && (
                    <p role="note" className="hub-flag">
                      {row.inactive}
                    </p>
                  )}
                  {/* Only an Admin gets the remove button; a Coordinator and a Director see the assignment. */}
                  {view.assign && <RemoveAssignmentForm rsn={view.rsn} row={row} action={actions.remove} initialState={initial?.remove?.[row.staffId]} />}
                </Stack>
              </li>
            ))}
          </Stack>
        </Stack>
      </section>

      {view.assign && <AssignForm rsn={view.rsn} labels={view.assign} action={actions.assign} initialState={initial?.assign} />}
    </Stack>
  );
}

function Missing({ view }: { view: CoverageMissingView }) {
  return (
    <Stack gap="related">
      <p role="alert" className="hub-error">{view.message}</p>
      <a className="tap hub-link" href={view.back.href}>
        {view.back.label}
      </a>
    </Stack>
  );
}

/** The screen's body for a resolved view: the list of buildings, one building's coverage, or a building that is not there. */
export function CoverageBody({ screen, actions, initial }: { screen: CoverageScreen; actions: CoverageActions; initial?: CoverageInitial }) {
  if (screen.kind === "list") return <List view={screen} />;
  if (screen.kind === "building") return <Building view={screen} actions={actions} initial={initial} />;
  return <Missing view={screen} />;
}
