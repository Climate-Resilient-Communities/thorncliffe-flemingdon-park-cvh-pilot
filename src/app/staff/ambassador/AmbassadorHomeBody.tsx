// The Ambassador's home as it is drawn (A-01, S08.01): one column for a phone. Pure: the layout tests and the screenshots render it on a view they built, and
// the page renders it on the person's own. The order is the order of need: which buildings are theirs, what is happening in them, their own posts, their round.
import { Stack } from "@/ui";
import type { AmbassadorHomeView } from "./view";

export function AmbassadorHomeBody({ view }: { view: AmbassadorHomeView }) {
  return (
    <Stack gap="section-hub-main">
      <Stack gap="related">
        <h1 className="hub-wrap">{view.title}</h1>
        <p>{view.lead}</p>
        {view.notAssigned ? (
          <p role="note" className="hub-flag hub-wrap" data-testid="not-assigned">
            {view.notAssigned}
          </p>
        ) : (
          <Stack as="ul" gap="subline" testId="assigned">
            {view.assigned.map((line) => (
              <li key={line} className="hub-wrap">
                {line}
              </li>
            ))}
          </Stack>
        )}
      </Stack>
      <section aria-labelledby="amb-active-title" data-testid="amb-active">
        <Stack gap="related">
          <h2 id="amb-active-title" className="hub-wrap">
            {view.active.title}
          </h2>
          {view.active.items.length === 0 ? (
            <p>{view.active.none}</p>
          ) : (
            <Stack as="ul" gap="related">
              {view.active.items.map((item) => (
                <li key={item.key} className="hub-list-item" data-testid="amb-alert">
                  <Stack gap="subline">
                    <p className="hub-wrap">
                      <strong>{item.title}</strong>
                    </p>
                    <p className="hub-wrap hub-preline">{item.headline}</p>
                    <p className="hub-wrap">{item.meta}</p>
                    <p className="hub-wrap">{item.about}</p>
                    <p className="hub-wrap">{item.until}</p>
                    <a className="tap hub-link" href={item.link.href}>
                      {item.link.label}
                    </a>
                  </Stack>
                </li>
              ))}
            </Stack>
          )}
        </Stack>
      </section>
      <section aria-labelledby="amb-posts-title" data-testid="amb-posts">
        <Stack gap="related">
          <h2 id="amb-posts-title" className="hub-wrap">
            {view.posts.title}
          </h2>
          {view.posts.items.length === 0 ? (
            <p>{view.posts.none}</p>
          ) : (
            <Stack as="ul" gap="related">
              {view.posts.items.map((item) => (
                <li key={item.key} className="hub-list-item" data-testid="amb-post">
                  <Stack gap="subline">
                    <p className="hub-wrap">
                      <strong>{item.title}</strong>
                    </p>
                    <p className="hub-wrap hub-preline">{item.text}</p>
                    <p className="hub-wrap" data-testid="amb-post-state">
                      {item.state}
                    </p>
                    <p className="hub-wrap">{item.about}</p>
                    {item.note && (
                      <p role="note" className="hub-flag hub-wrap hub-preline" data-testid="amb-post-note">
                        {item.note}
                      </p>
                    )}
                  </Stack>
                </li>
              ))}
            </Stack>
          )}
        </Stack>
      </section>
      <section aria-labelledby="amb-round-title" data-testid="amb-round">
        <Stack gap="related">
          <h2 id="amb-round-title" className="hub-wrap">
            {view.round.title}
          </h2>
          {view.round.line !== null && (
            <p className="hub-wrap" data-testid="amb-round-count">
              {view.round.line}
            </p>
          )}
          {view.round.none !== null && <p className="hub-wrap">{view.round.none}</p>}
        </Stack>
      </section>
    </Stack>
  );
}
