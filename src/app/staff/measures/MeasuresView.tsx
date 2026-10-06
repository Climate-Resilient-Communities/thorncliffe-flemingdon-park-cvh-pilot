import { Stack } from "@/ui";
import { ProcedureLink } from "../ProcedureLink";
import type { CostView, MeasuresView as MeasuresViewModel, ReachEntryView, ReachView, SubscribersView } from "./view";

/**
 * The Hub's pilot measures page (S07.10), as it is drawn: the subscribers the daily job counted, how far corrections, withdrawals and finals reached, and (for an
 * Admin or a Director, AD-4) what each alert cost. Counts only, read-only and with no control: the view model carries every word, so the tests and the screenshots
 * draw this very markup. Drills have a list of their own in each section. Under the lead (S09.05): where the full set of measures is, the export an Admin writes,
 * and the link to its procedure, the page's one link.
 */

function Entries({ items, testId }: { items: ReachEntryView[]; testId: string }) {
  return (
    <Stack as="ul" gap="related" testId={testId}>
      {items.map((item) => (
        <li key={item.id} className="hub-list-item">
          <Stack gap="subline">
            <h4 className="hub-wrap">{item.title}</h4>
            {item.lines.map((line, index) => (
              <p key={index} className="hub-wrap">
                {line}
              </p>
            ))}
          </Stack>
        </li>
      ))}
    </Stack>
  );
}

function Subscribers({ view }: { view: SubscribersView }) {
  return (
    <section aria-labelledby="measures-subscribers-title" data-testid="measures-subscribers">
      <Stack gap="related">
        <h2 id="measures-subscribers-title">{view.heading}</h2>
        <p data-testid="measures-subscribers-lead">{view.lead}</p>
        <Stack as="ul" gap="related">
          {view.measures.map((measure) => (
            <li key={measure.id} className="hub-list-item" data-testid={`measure-${measure.id}`}>
              <Stack gap="subline">
                <h3 className="hub-wrap">{measure.name}</h3>
                <p>
                  <strong>{measure.total}</strong>
                </p>
                <p className="hub-wrap">{measure.byLanguage}</p>
                <p className="hub-wrap">{measure.byNeighbourhood}</p>
              </Stack>
            </li>
          ))}
        </Stack>
      </Stack>
    </section>
  );
}

function Reach({ view }: { view: ReachView }) {
  return (
    <section aria-labelledby="measures-reach-title" data-testid="measures-reach">
      <Stack gap="related">
        <h2 id="measures-reach-title">{view.heading}</h2>
        <p>{view.lead}</p>
        {view.real.length === 0 ? <p data-testid="measures-reach-empty">{view.realEmpty}</p> : <Entries items={view.real} testId="measures-reach-real" />}
        <h3 id="measures-reach-drills-title">{view.drillsHeading}</h3>
        {view.drills.length === 0 ? <p>{view.drillsEmpty}</p> : <Entries items={view.drills} testId="measures-reach-drills" />}
      </Stack>
    </section>
  );
}

function Cost({ view }: { view: CostView }) {
  return (
    <section aria-labelledby="measures-cost-title" data-testid="measures-cost">
      <Stack gap="related">
        <h2 id="measures-cost-title">{view.heading}</h2>
        <p>{view.lead}</p>
        {view.real.length === 0 ? <p data-testid="measures-cost-empty">{view.realEmpty}</p> : <Entries items={view.real} testId="measures-cost-real" />}
        <h3 id="measures-cost-drills-title">{view.drillsHeading}</h3>
        {view.drills.length === 0 ? <p>{view.drillsEmpty}</p> : <Entries items={view.drills} testId="measures-cost-drills" />}
        <Stack gap="subline" testId="measures-cohere">
          <h3>{view.cohere.heading}</h3>
          <p>{view.cohere.lead}</p>
          {view.cohere.lines.length === 0 ? (
            <p>{view.cohere.empty}</p>
          ) : (
            view.cohere.lines.map((line, index) => (
              <p key={index} className="hub-wrap">
                {line}
              </p>
            ))
          )}
        </Stack>
      </Stack>
    </section>
  );
}

export function MeasuresView({ view }: { view: MeasuresViewModel }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <h1>{view.title}</h1>
        <p>{view.lead}</p>
        <p data-testid="measures-privacy">{view.privacy}</p>
        <p data-testid="measures-export">{view.exportNote}</p>
        <ProcedureLink link={view.procedure} />
      </Stack>
      <Subscribers view={view.subscribers} />
      <Reach view={view.reach} />
      {view.cost ? <Cost view={view.cost} /> : null}
    </Stack>
  );
}
