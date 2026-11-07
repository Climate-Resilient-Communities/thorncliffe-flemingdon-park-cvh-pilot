import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { decisionsOf, listOrgs, openSharedSpace } from "@/modules/partners";
import { partnersDb } from "../db";
import { Screen, Stack } from "@/ui";
import { disruptionLinks } from "../area";
import { partnerPage } from "../guarded";
import { AreaHeading, AreaLinks } from "../parts";
import { PARTNER_PAGES } from "../view";
import { ago, clock, hazardWord } from "../words";

export const metadata: Metadata = { title: englishText("hub.nav.decisions") };

/**
 * "Decision log" (P-09, 2026-11-07, read-only in this release): the decisions of the open disruption's shared space, newest first, each with
 * who decided, when and why, separate from the conversation. It stays with the disruption's record when the shared space closes.
 */
export default partnerPage(PARTNER_PAGES.decisions, () => englishText("hub.nav.decisions"), async () => {
  const db = partnersDb();
  const now = new Date();
  const [shared, orgs] = await Promise.all([openSharedSpace(db), listOrgs(db)]);
  const decisions = shared ? await decisionsOf(db, shared.id) : [];
  const orgName = new Map(orgs.map((org) => [org.id, org.shortName]));
  const title = shared ? englishText("P09.title", { what: `${hazardWord(shared.hazard)}, ${shared.location}` }) : englishText("hub.nav.decisions");
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={title} lead={englishText("P09.lead")} area="disruption" />
        <p className="hub-flag">{englishText("P09.kept")}</p>
        {decisions.length === 0 ? (
          <section className="hub-card">
            <Stack gap="subline">
              <h2>{englishText("P09.emptyTitle")}</h2>
              <p>{englishText("P09.emptyLine")}</p>
            </Stack>
          </section>
        ) : (
          <Stack as="ol" gap="related" testId="decision-log">
            {decisions.map((d) => (
              <li key={d.id} className="hub-card hub-card--covered" data-testid={`decision-${d.id}`}>
                <Stack gap="subline">
                  <div className="hub-card__head">
                    <span className="hub-card__title">{d.body}</span>
                    <span className="hub-card__meta">
                      {clock(d.decidedAt)} · {ago(d.decidedAt, now)}
                    </span>
                  </div>
                  <p className="hub-wrap">
                    <strong>{englishText("P09.whyLabel")}:</strong> {d.why}
                  </p>
                  <p className="hub-card__meta">
                    {d.person}, {orgName.get(d.orgId) ?? d.orgId}
                  </p>
                </Stack>
              </li>
            ))}
          </Stack>
        )}
        <AreaLinks label={englishText("P02.linksAria")} links={disruptionLinks()} />
      </Stack>
    </Screen>
  );
});
