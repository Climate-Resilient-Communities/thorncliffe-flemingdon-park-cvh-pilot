import type { ReactNode } from "react";
import { Inline, Stack } from "@/ui";
import { ProcedureLink } from "../ProcedureLink";
import type { ProcedureLinkView } from "../procedures";
import type { CampaignPageText, CampaignScreen } from "./view";

/**
 * The End of the pilot page's body (S09.07), as it is drawn: the heading, then by phase the rehearsal and the confirmation of the start (before), how far the
 * campaign has got (while it runs) or who stayed (after it), and sign-ups. The forms come in as `forms`, keyed by where they go, so this file holds no behaviour
 * and the tests draw the very same markup; its fixed words come in as `text` (resolved by the server: this file is drawn in the browser too, and imports no
 * catalog). `unreadable` is a campaign the Hub could not read: the page says so and offers nothing. `procedure` is the link to the end-of-pilot procedure (S09.03),
 * under the lead, built on the server.
 */
export function CampaignView({
  text,
  procedure,
  screen,
  unreadable = false,
  answer,
  forms,
}: {
  text: CampaignPageText;
  procedure: ProcedureLinkView;
  screen: CampaignScreen | null;
  unreadable?: boolean;
  /** The answer region of the forms (always in the page: a live region must exist before its text does). */
  answer?: ReactNode;
  forms?: { rehearse?: ReactNode; start?: ReactNode; reopen?: ReactNode };
}) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <h1>{text["title"]}</h1>
        <p>{text["lead"]}</p>
        <ProcedureLink link={procedure} />
      </Stack>
      {answer}
      {unreadable || screen === null ? (
        <p role="alert" className="hub-error" data-testid="campaign-unreadable">
          {text["errors.unreadable"]}
        </p>
      ) : (
        <>
          {screen.rehearsal ? (
            <section aria-labelledby="campaign-rehearsal" data-testid="campaign-rehearsal">
              <Stack gap="stack">
                <Stack gap="related">
                  <h2 id="campaign-rehearsal">{text["rehearsal.heading"]}</h2>
                  <p>{text["rehearsal.lead"]}</p>
                  <p>{screen.rehearsal.roster}</p>
                  {screen.rehearsal.emptyRoster ? <p className="hub-flag">{screen.rehearsal.emptyRoster}</p> : null}
                  <p data-testid="campaign-last-rehearsal">{screen.rehearsal.last}</p>
                  {screen.rehearsal.texts ? <p>{screen.rehearsal.texts}</p> : null}
                </Stack>
                {screen.rehearsal.canRehearse ? forms?.rehearse : null}
              </Stack>
            </section>
          ) : null}
          {screen.start ? (
            <section aria-labelledby="campaign-start" data-testid="campaign-start">
              <Stack gap="stack">
                <h2 id="campaign-start">{text["start.heading"]}</h2>
                {screen.start.needsRehearsal ? (
                  <p className="hub-flag" data-testid="campaign-needs-rehearsal">
                    {screen.start.needsRehearsal}
                  </p>
                ) : null}
                <Stack gap="related">
                  <p>
                    <strong data-testid="campaign-deadline">{screen.start.deadline}</strong>
                  </p>
                  <p>{screen.start.deadlineHint}</p>
                </Stack>
                <Stack gap="related">
                  <p data-testid="campaign-asked">{screen.start.asked}</p>
                  {screen.start.noSubscribers ? (
                    <p>{screen.start.noSubscribers}</p>
                  ) : (
                    <Stack gap="related">
                      <h3>{text["start.languagesHeading"]}</h3>
                      <Stack gap="subline" as="ul" testId="campaign-languages">
                        {screen.start.languages.map((row) => (
                          <li key={row.language}>
                            <Inline gap="related" align="baseline" wrap>
                              <strong className="hub-wrap">{row.language}</strong>
                              <span>{row.subscribers}</span>
                            </Inline>
                          </li>
                        ))}
                      </Stack>
                    </Stack>
                  )}
                  <p data-testid="campaign-cost">{screen.start.cost}</p>
                  {screen.start.capNotice ? (
                    <p className="hub-flag" data-testid="campaign-cap">
                      {screen.start.capNotice}
                    </p>
                  ) : null}
                </Stack>
                <p>{screen.start.what}</p>
                <Stack gap="related">
                  <p>{screen.start.textHeading}</p>
                  <p className="hub-flag hub-wrap" data-testid="campaign-text">
                    {screen.start.text}
                  </p>
                </Stack>
                {screen.start.needsRehearsal ? null : forms?.start}
              </Stack>
            </section>
          ) : null}
          {screen.running ? (
            <section aria-labelledby="campaign-running" data-testid="campaign-running">
              <Stack gap="related">
                <h2 id="campaign-running">{text["running.heading"]}</h2>
                <p>{screen.running.started}</p>
                <p>
                  <strong>{screen.running.deadline}</strong>
                </p>
                <p>{screen.running.asked}</p>
                <p>{screen.running.kept}</p>
                <p>{screen.running.texts}</p>
              </Stack>
            </section>
          ) : null}
          {screen.ended ? (
            <section aria-labelledby="campaign-ended" data-testid="campaign-ended">
              <Stack gap="related">
                <h2 id="campaign-ended">{text["ended.heading"]}</h2>
                <p>{screen.ended.when}</p>
                <p>{screen.ended.kept}</p>
                <p>{screen.ended.lapsed}</p>
                <p>{screen.ended.purge}</p>
              </Stack>
            </section>
          ) : null}
          <section aria-labelledby="campaign-signups" data-testid="campaign-signups">
            <Stack gap="stack">
              <Stack gap="related">
                <h2 id="campaign-signups">{text["signups.heading"]}</h2>
                <p>{screen.signups.line}</p>
                {screen.signups.hint ? <p>{screen.signups.hint}</p> : null}
              </Stack>
              {screen.signups.canReopen ? forms?.reopen : null}
            </Stack>
          </section>
        </>
      )}
    </Stack>
  );
}
