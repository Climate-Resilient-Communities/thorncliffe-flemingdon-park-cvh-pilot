// The Hub home as it is drawn (O-01; S04.07's list of what waits, S04.10's screen): what waits for the person with how long it has waited, the open
// threads, the person's own alerts, and the drills in their own labelled section. Pure: the layout tests and the screenshots render it on a view they built,
// and the Hub home renders it on the person's own (IncidentsPanel.tsx).
//
// Below 800 px of content width it is one column, the main content first (what waits for the person, always above the links that start something, then the open threads, the person's alerts) and the second
// column (the routine tasks, then the drills) after it, filling the width; from 800 px two columns with the page's approved gap. A Director gets the same screen with no link to anything that
// changes something.
import { englishText } from "@/i18n/text";
import { Grid, Stack } from "@/ui";
import type { IncidentItemView, IncidentsView } from "./view";

function Items({ items, id }: { items: IncidentItemView[]; id: string }) {
  return (
    <Stack as="ul" gap="related">
      {items.map((item) => (
        <li key={item.key} className="hub-list-item" data-testid={`${id}-item`} data-drill={item.drill ? "true" : undefined}>
          <Stack gap="subline">
            <p className="hub-wrap">
              <strong>{item.title}</strong>
            </p>
            {item.place && (
              <p className="hub-wrap" data-testid="item-place">
                {item.place}
              </p>
            )}
            <p className="hub-wrap">{[item.state, item.since].filter(Boolean).join(" · ")}</p>
            {item.waited && (
              <p className="hub-wrap" data-testid="waited">
                <strong>{item.waited}</strong>
              </p>
            )}
            {item.note && (
              <p role="note" className="hub-flag hub-wrap hub-preline" data-testid="returned-note">
                {item.note}
              </p>
            )}
            {item.detail && (
              <p className="hub-wrap hub-preline" lang="en" data-testid="closed-final">
                {item.detail}
              </p>
            )}
            {item.link && (
              <a className="tap hub-link" href={item.link.href}>
                {item.link.label}
              </a>
            )}
            {item.more?.map((link) => (
              <a key={link.href} className="tap hub-link" href={link.href} data-testid="item-more">
                {link.label}
              </a>
            ))}
          </Stack>
        </li>
      ))}
    </Stack>
  );
}

/** The screen for a view that was already loaded (the tests and the page both render this). */
export function IncidentsList({ view }: { view: IncidentsView }) {
  const quiet = !view.waiting?.items.length && !view.running?.items.length && !view.mine.items.length && !view.drills.items.length;
  const main = (
    <Stack gap="section-hub-main">
      <Stack gap="related">
        <h1 className="hub-wrap">{view.title}</h1>
        <p>{quiet ? englishText("staff.homeTasks.quiet") : view.lead}</p>
        {view.readOnly && (
          <p role="note" className="hub-flag hub-wrap" data-testid="read-only">
            {view.readOnly}
          </p>
        )}
      </Stack>
      {view.waiting && !quiet && (
        <section aria-labelledby="incidents-waiting-title" data-testid="incidents-waiting">
          <Stack gap="related">
            <h2 id="incidents-waiting-title" className="hub-wrap">{view.waiting.title}</h2>
            <p>{view.waiting.items.length > 0 ? view.waiting.lead : view.waiting.none}</p>
            {view.waiting.items.length > 0 && <Items items={view.waiting.items} id="waiting" />}
          </Stack>
        </section>
      )}
      {view.start && (
        <nav aria-label={view.start.title} data-testid="incidents-start">
          <Stack gap="related">
            <h2>{englishText("staff.homeTasks.start")}</h2>
            <p>{englishText("staff.homeTasks.startDetail")}</p>
          <Stack as="ul" gap="subline">
            {view.start.links.map((link) => (
              <li key={link.id}>
                <a className="tap hub-link" href={link.href} data-testid={`start-${link.id}`}>
                  {link.label}
                </a>
              </li>
            ))}
          </Stack>
          </Stack>
        </nav>
      )}
      {view.running && !quiet && (
        <section aria-labelledby="incidents-running-title" data-testid="incidents-running">
          <Stack gap="related">
            <h2 id="incidents-running-title" className="hub-wrap">{view.running.title}</h2>
            <p>{view.running.items.length > 0 ? view.running.lead : view.running.none}</p>
            {view.running.items.length > 0 && <Items items={view.running.items} id="running" />}
          </Stack>
        </section>
      )}
      {view.closed && (
        <section aria-labelledby="incidents-closed-title" data-testid="incidents-closed">
          <Stack gap="related">
            <h2 id="incidents-closed-title" className="hub-wrap">{view.closed.title}</h2>
            <p>{view.closed.lead}</p>
            <Items items={view.closed.items} id="closed" />
          </Stack>
        </section>
      )}
      {!quiet && (view.mine.items.length > 0 || view.waiting) && (
        <section aria-labelledby="incidents-mine-title" data-testid="incidents-mine">
          <Stack gap="related">
            <h2 id="incidents-mine-title" className="hub-wrap">{view.mine.title}</h2>
            {view.mine.items.length > 0 ? <Items items={view.mine.items} id="mine" /> : <p>{view.mine.none}</p>}
          </Stack>
        </section>
      )}
    </Stack>
  );
  // The second column: the routine tasks between disruptions in a section of their own, then the drills in their own labelled aside (a quiet home
  // has no drills to list, so it shows the routine tasks only).
  const aside = (
    <Stack gap="section-hub-main" testId="incidents-side">
      {view.routine && (
        <section aria-labelledby="routine-heading" data-testid="incidents-routine">
          <Stack gap="related">
            <h2 id="routine-heading" className="hub-wrap">{englishText("staff.homeTasks.routine")}</h2>
            <p>{englishText("staff.homeTasks.routineDetail")}</p>
            <Stack as="ul" gap="stack">
              {view.routine.map((task) => (
                <li key={task.href}>
                  <a className="hub-link tap" href={task.href}>
                    {task.label}
                  </a>
                  <p>{task.detail}</p>
                </li>
              ))}
            </Stack>
          </Stack>
        </section>
      )}
      {!quiet && (
        <aside aria-labelledby="incidents-drills-title" data-testid="incidents-drills">
          <Stack gap="related">
            <h2 id="incidents-drills-title" className="hub-wrap">{view.drills.title}</h2>
            <p>{view.drills.items.length > 0 ? view.drills.lead : view.drills.none}</p>
            {view.drills.items.length > 0 && <Items items={view.drills.items} id="drill" />}
          </Stack>
        </aside>
      )}
    </Stack>
  );
  return (
    <Grid twoColumn="aside">
      {main}
      {aside}
    </Grid>
  );
}
