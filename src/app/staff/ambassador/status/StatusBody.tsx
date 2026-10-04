// An ambassador's post status as it is drawn (A-03, S08.04): one column for a phone. The order is the order of need: where the post stands, what else waits for
// the Hub, once approved how its texts are going, what was posted, and what the person may do about it. The layout tests and the screenshots render it on a view
// they built; the page renders it on the person's own.
import { Stack } from "@/ui";
import { FollowForms, type FollowInitial } from "./FollowForms";
import type { ResolveScreen, StatusScreen } from "./view";

export function StatusBody({ screen, followInitial }: { screen: StatusScreen; followInitial?: FollowInitial }) {
  return (
    <div className="hub-wrap">
      <Stack gap="section-hub-main">
        <Stack gap="related">
          <a className="tap hub-link" href={screen.back.href}>
            {screen.back.label}
          </a>
          <h1>{screen.title}</h1>
        </Stack>

        <section aria-labelledby="status-state" data-testid="status-state" data-state={screen.state.id} className="hub-list-item">
          <Stack gap="related">
            <h2 id="status-state" className="hub-wrap">
              {screen.state.title}
            </h2>
            <p className="hub-wrap">{screen.state.body}</p>
            {screen.state.sub && <p className="hub-wrap">{screen.state.sub}</p>}
            {screen.state.note && (
              <p role="note" className="hub-flag hub-wrap hub-preline" data-testid="status-note">
                {screen.state.note}
              </p>
            )}
          </Stack>
        </section>

        {screen.waiting.length > 0 && (
          <Stack as="ul" gap="related" testId="status-waiting">
            {screen.waiting.map((line) => (
              <li key={line} className="hub-flag hub-wrap">
                {line}
              </li>
            ))}
          </Stack>
        )}

        {screen.progress && (
          <section aria-labelledby="status-progress" data-testid="status-progress">
            <Stack gap="related">
              <h2 id="status-progress" className="hub-wrap">
                {screen.progress.title}
              </h2>
              {screen.progress.none ? (
                <p className="hub-wrap" data-testid="status-progress-none">
                  {screen.progress.none}
                </p>
              ) : (
                <Stack as="ul" gap="subline">
                  {screen.progress.lines.map((line) => (
                    <li key={line.id} className="hub-wrap" data-count={line.id} data-n={line.n}>
                      {line.text}
                    </li>
                  ))}
                </Stack>
              )}
              {screen.progress.hint && <p className="hub-wrap">{screen.progress.hint}</p>}
            </Stack>
          </section>
        )}

        <section aria-labelledby="status-yours" data-testid="status-yours">
          <Stack gap="related">
            <h2 id="status-yours" className="hub-wrap">
              {screen.yours.title}
            </h2>
            <div className="hub-list-item">
              <Stack gap="subline">
                <p className="hub-wrap">
                  <strong>{screen.yours.types}</strong>
                </p>
                <p className="hub-wrap">{screen.yours.floors}</p>
                <p className="hub-wrap hub-preline">{screen.yours.text}</p>
                {screen.yours.meta.map((line) => (
                  <p key={line} className="hub-wrap">
                    {line}
                  </p>
                ))}
              </Stack>
            </div>
            <a className="tap hub-link" href={screen.yours.residents.href}>
              {screen.yours.residents.label}
            </a>
          </Stack>
        </section>

        {screen.follow && (
          <FollowForms screen={screen.follow} initial={followInitial} />
        )}
      </Stack>
    </div>
  );
}

/** "Mark resolved" for an alert about the person's building (S08.04): the lead, the alert it ends and the one form. */
export function ResolveBody({ screen, followInitial }: { screen: ResolveScreen; followInitial?: FollowInitial }) {
  return (
    <div className="hub-wrap">
      <Stack gap="section-hub-main">
        <Stack gap="related">
          <a className="tap hub-link" href={screen.back.href}>
            {screen.back.label}
          </a>
          <h1>{screen.title}</h1>
          <p className="hub-preline" data-testid="resolve-about">
            {screen.about}
          </p>
        </Stack>
        {screen.waiting && (
          <p role="note" className="hub-flag hub-wrap" data-testid="resolve-waiting">
            {screen.waiting}
          </p>
        )}
        {screen.follow && <FollowForms screen={screen.follow} initial={followInitial} />}
      </Stack>
    </div>
  );
}
