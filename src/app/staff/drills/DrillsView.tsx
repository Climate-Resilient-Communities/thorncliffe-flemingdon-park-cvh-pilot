import { Inline, Stack } from "@/ui";
import type { DrillView, DrillsView as DrillsModel } from "./view";

function Drill({ drill }: { drill: DrillView }) {
  return (
    <li className="hub-list-item" data-testid="drill" data-status={drill.status.id}>
      <Stack gap="related">
        <Inline gap="related" align="baseline" wrap>
          <h3 className="hub-wrap">{drill.heading}</h3>
          <span data-testid="drill-status">{drill.status.text}</span>
        </Inline>
        <p className="hub-wrap" data-testid="drill-entries">
          {drill.entries}
        </p>
        <section aria-label={drill.results.title} data-testid="drill-results">
          <Stack gap="related">
            <h4>{drill.results.title}</h4>
            {drill.results.none ? (
              <p data-testid="drill-results-none">{drill.results.none}</p>
            ) : (
              <Stack gap="stack" as="ul" testId="drill-result-rows">
                {drill.results.rows.map((row) => (
                  <li key={row.key} data-testid="drill-result-row">
                    <Stack gap="subline">
                      <Inline gap="related" align="baseline" wrap>
                        <strong className="hub-wrap">{row.member}</strong>
                        <span className="hub-wrap">{row.language}</span>
                      </Inline>
                      <Inline gap="related" wrap>
                        {row.counts.map((count) => (
                          <span key={count.id} data-count={count.id}>
                            {count.text}
                          </span>
                        ))}
                      </Inline>
                    </Stack>
                  </li>
                ))}
              </Stack>
            )}
            {drill.results.waiting ? <p data-testid="drill-waiting">{drill.results.waiting}</p> : null}
            {drill.results.notSent ? <p data-testid="drill-not-sent">{drill.results.notSent}</p> : null}
            {drill.results.unknownNote ? (
              <p role="note" className="hub-flag" data-testid="drill-unknown-note">
                {drill.results.unknownNote}
              </p>
            ) : null}
          </Stack>
        </section>
      </Stack>
    </li>
  );
}

/**
 * The Drills page's body (S06.05), as it is drawn: the heading, how to start a drill and who it reaches (the drill roster, with its link), and the recent drills,
 * each with what became of its texts per roster member and language (handed off, delivered, undelivered, failed, unknown). Drill counts are kept apart from every
 * real alert's, and the page says so. No behaviour, so the layout tests and the screenshots draw the very same markup.
 */
export function DrillsView({ view }: { view: DrillsModel }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <h1>{view.title}</h1>
        <p>{view.lead}</p>
      </Stack>
      <Stack gap="related" testId="drills-start">
        <p>{view.start.lead}</p>
        {/* A form, so the button is the Hub's own: it opens the start page and changes nothing. */}
        <form action={view.start.href} method="get">
          <button className="hub-button hub-button--primary" type="submit" data-testid="drills-start-link">
            {view.start.label}
          </button>
        </form>
      </Stack>
      <Stack gap="related" testId="drills-roster">
        <p role="status" data-testid="drills-roster-summary">
          {view.roster.summary}
        </p>
        <a className="tap hub-link" href={view.roster.link.href} data-testid="drills-roster-link">
          {view.roster.link.label}
        </a>
      </Stack>
      <section aria-labelledby="drills-recent-title">
        <Stack gap="related">
          <h2 id="drills-recent-title">{view.recent.title}</h2>
          {view.recent.none ? (
            <p data-testid="drills-none">{view.recent.none}</p>
          ) : (
            <Stack gap="stack" as="ul" testId="drills-list">
              {view.recent.drills.map((drill) => (
                <Drill key={drill.id} drill={drill} />
              ))}
            </Stack>
          )}
          <small>{view.recent.apart}</small>
        </Stack>
      </section>
    </Stack>
  );
}
