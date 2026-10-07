import { orderedByLanguage } from "@/ui/shell/language-order";
// The sending progress block (S06.09, O-06), drawn from its view model: the counts per language, the sentence about texts already handed to the provider
// while texts are paused, the lists of the texts that did not arrive, and what the counts mean. It is drawn in the published confirmation and in the alert's
// staff view. The only behaviour is the page reloading itself every 15 seconds while a text waits or is in flight, so the layout tests and the screenshots
// (which draw `SendingProgressBody`) show the very same markup.
import { Inline, Stack } from "@/ui";
import { AutoRefresh } from "./AutoRefresh";
import type { LanguageProgressView, SendingProgressView } from "./view";

function CountRow({ row }: { row: LanguageProgressView }) {
  return (
    <li className="hub-list-item" data-testid={`sending-${row.lang}`}>
      <Stack gap="subline">
        <p className="hub-wrap">
          <strong>{row.label}</strong>
        </p>
        <Inline gap="related" wrap>
          {row.counts.map((count) => (
            <span key={count.id} className="hub-wrap" data-count={count.id} data-n={count.n}>
              {count.text}
            </span>
          ))}
        </Inline>
      </Stack>
    </li>
  );
}

/** The block as it is drawn, without the timer. */
export function SendingProgressBody({ view }: { view: SendingProgressView }) {
  return (
    <section aria-labelledby="sending-title" data-testid="sending" data-live={view.live ? "true" : "false"} data-refresh={view.live ? view.refresh.seconds : undefined}>
      <Stack gap="related">
        <h2 id="sending-title" className="hub-wrap">
          {view.title}
        </h2>
        <p className="hub-wrap">{view.lead}</p>
        {view.none ? (
          <p className="hub-wrap" data-testid="sending-none">
            {view.none}
          </p>
        ) : (
          <>
            <p className="hub-wrap" data-testid="sending-summary">
              {view.summary}
            </p>
            {view.handedOff ? (
              <p role="note" className="hub-flag hub-wrap" data-testid="sending-handed-off">
                {view.handedOff}
              </p>
            ) : null}
            <Stack as="ul" gap="related" testId="sending-languages">
              {orderedByLanguage(view.languages, (row) => row.lang).map((row) => (
                <CountRow key={row.lang} row={row} />
              ))}
              {view.total ? <CountRow row={view.total} /> : null}
            </Stack>
            {view.problems ? (
              <Stack gap="related" testId="sending-problems">
                <h3 className="hub-wrap">{view.problems.title}</h3>
                <p className="hub-wrap">{view.problems.lead}</p>
                <Stack as="ul" gap="subline">
                  {view.problems.links.map((link) => (
                    <li key={link.state}>
                      <a className="tap hub-link hub-wrap" href={link.href} data-testid={`sending-list-${link.state}`}>
                        {link.label}
                      </a>
                    </li>
                  ))}
                </Stack>
              </Stack>
            ) : null}
            <details>
              <summary className="tap hub-summary">{view.legend.title}</summary>
              <Stack as="ul" gap="subline" testId="sending-legend">
                {view.legend.items.map((item) => (
                  <li key={item} className="hub-wrap">
                    {item}
                  </li>
                ))}
              </Stack>
            </details>
            <small className="hub-wrap" data-testid="sending-refresh">
              {view.refresh.note}
            </small>
          </>
        )}
      </Stack>
    </section>
  );
}

/** The block, reloading itself every `view.refresh.seconds` while texts are going out. */
export function SendingProgress({ view }: { view: SendingProgressView }) {
  return (
    <>
      <SendingProgressBody view={view} />
      {view.live ? <AutoRefresh seconds={view.refresh.seconds} /> : null}
    </>
  );
}
