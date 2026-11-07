import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { handoversOf, listOrgs, openSharedSpace, statementsOf } from "@/modules/partners";
import { partnersDb } from "../db";
import { Screen, Stack } from "@/ui";
import { disruptionLinks } from "../area";
import { partnerPage } from "../guarded";
import { AreaHeading, AreaLinks } from "../parts";
import { PARTNER_PAGES } from "../view";
import { ago, clock, hazardWord, pw } from "../words";

export const metadata: Metadata = { title: englishText("staff.partners.handover.title") };

/**
 * "Handover" (P-10, 2026-11-07, read-only in this release): the handover notes of the open disruption's shared space, newest first, each with
 * who handed to whom, one line for the next person and what was still open; and what a handover does, so whoever leaves knows what to write.
 * Writing a handover is not in this release: it is done in the shared space's conversation for now.
 */
export default partnerPage(PARTNER_PAGES.handover, () => pw("handover.title"), async () => {
  const db = partnersDb();
  const now = new Date();
  const [shared, orgs] = await Promise.all([openSharedSpace(db), listOrgs(db)]);
  const [handovers, statements] = shared ? await Promise.all([handoversOf(db, shared.id), statementsOf(db, shared.id)]) : [[], []];
  const orgName = new Map(orgs.map((org) => [org.id, org.shortName]));
  const statementText = new Map(statements.map((s) => [s.id, s.body]));
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={pw("handover.title")} lead={shared ? englishText("P10.inSpace", { hazard: hazardWord(shared.hazard), where: shared.location }) : undefined} area="disruption" />
        <section aria-labelledby="what-title" className="hub-card hub-card--waiting">
          <Stack gap="subline">
            <h2 id="what-title">{englishText("P10.whatTitle")}</h2>
            <ul>
              {[0, 1, 2].map((line) => (
                <li key={line}>{englishText(`P10.what.${line}`, { to: englishText("P10.whatNobody") })}</li>
              ))}
            </ul>
          </Stack>
        </section>
        {handovers.length === 0 ? (
          <p>{englishText("P10.prevNone")}</p>
        ) : (
          <Stack as="ol" gap="related" testId="handover-notes">
            {handovers.map((h, at) => (
              <li key={h.id} className={`hub-card hub-card--${at === 0 ? "full" : "closed"}`} data-testid={`handover-${h.id}`}>
                <Stack gap="subline">
                  <div className="hub-card__head">
                    <span className="hub-card__title">{h.toPerson ? englishText("P02.hoFromTo", { from: h.fromPerson, to: h.toPerson }) : englishText("P02.hoToNobody", { from: h.fromPerson })}</span>
                    <span className="hub-card__meta">
                      {clock(h.handedAt)} · {ago(h.handedAt, now)}
                    </span>
                  </div>
                  <p className="hub-card__meta">{orgName.get(h.orgId) ?? h.orgId}</p>
                  <p className="hub-wrap">{h.note}</p>
                  {h.openItems.length > 0 && (
                    <p className="hub-flag hub-wrap">{englishText("P02.hoOpen", { list: h.openItems.map((id) => statementText.get(id) ?? id).join(" · ") })}</p>
                  )}
                </Stack>
              </li>
            ))}
          </Stack>
        )}
        <p>
          <small>{pw("handover.notInRelease")}</small>
        </p>
        <AreaLinks label={englishText("P02.linksAria")} links={disruptionLinks()} />
      </Stack>
    </Screen>
  );
});
