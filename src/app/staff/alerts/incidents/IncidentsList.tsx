// The incidents list as it is drawn (S04.07's share of the Hub home): what waits for the person and what they have in hand. Pure: the layout tests and the
// screenshots render it on a view they built, and the Hub home renders it on the person's own (IncidentsPanel.tsx).
import { Stack } from "@/ui";
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
            <p className="hub-wrap">{[item.state, item.since].filter(Boolean).join(" · ")}</p>
            {item.note && (
              <p role="note" className="hub-flag hub-wrap hub-preline" data-testid="returned-note">
                {item.note}
              </p>
            )}
            <a className="tap hub-link" href={item.link.href}>
              {item.link.label}
            </a>
          </Stack>
        </li>
      ))}
    </Stack>
  );
}

/** The panel for a view that was already loaded (the tests and the page both render this). */
export function IncidentsList({ view }: { view: IncidentsView }) {
  return (
    <Stack gap="stack">
      {view.waiting && (
        <section aria-labelledby="incidents-waiting-title" data-testid="incidents-waiting">
          <Stack gap="related">
            <h2 id="incidents-waiting-title">{view.waiting.title}</h2>
            <p>{view.waiting.items.length > 0 ? view.waiting.lead : view.waiting.none}</p>
            {view.waiting.items.length > 0 && <Items items={view.waiting.items} id="waiting" />}
          </Stack>
        </section>
      )}
      {view.running && (
        <section aria-labelledby="incidents-running-title" data-testid="incidents-running">
          <Stack gap="related">
            <h2 id="incidents-running-title">{view.running.title}</h2>
            <p>{view.running.items.length > 0 ? view.running.lead : view.running.none}</p>
            {view.running.items.length > 0 && <Items items={view.running.items} id="running" />}
          </Stack>
        </section>
      )}
      {(view.mine.items.length > 0 || view.waiting) && (
        <section aria-labelledby="incidents-mine-title" data-testid="incidents-mine">
          <Stack gap="related">
            <h2 id="incidents-mine-title">{view.mine.title}</h2>
            {view.mine.items.length > 0 ? <Items items={view.mine.items} id="mine" /> : <p>{view.mine.none}</p>}
          </Stack>
        </section>
      )}
      {view.drills && (
        <section aria-labelledby="incidents-drills-title" data-testid="incidents-drills">
          <Stack gap="related">
            <h2 id="incidents-drills-title">{view.drills.title}</h2>
            <Items items={view.drills.items} id="drill" />
          </Stack>
        </section>
      )}
    </Stack>
  );
}
