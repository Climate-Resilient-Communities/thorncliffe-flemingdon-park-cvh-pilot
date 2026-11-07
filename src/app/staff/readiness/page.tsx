import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { listCommitments, listOrgs, type CommitmentRow } from "@/modules/partners";
import { getDb } from "@/platform/db";
import { Screen, Stack } from "@/ui";
import { readinessLinks } from "../partners/area";
import { partnerPage } from "../partners/guarded";
import { AreaHeading, AreaLinks, Pill } from "../partners/parts";
import { PARTNER_PAGES } from "../partners/view";
import { day, hazardWord, pw, torontoToday } from "../partners/words";

export const metadata: Metadata = { title: englishText("hub.nav.commitments") };

/** The six disruptions residents plan for on Be ready, then winter (the pilot's November), as P-11's table lists them. */
const READINESS_HAZARDS = ["power", "flood", "elevator", "heat", "smoke", "fire", "winter"] as const;
const MODES = ["everyday", "during", "recovery"] as const;

/** One commitment as a card: the organisation, what it does, the role, the agreement and its review date (flagged when overdue). */
function Commitment({ c, org, today }: { c: CommitmentRow; org: string; today: string }) {
  return (
    <li className={`hub-card hub-card--${c.reviewDue < today ? "waiting" : "covered"}`} data-testid={`commitment-${c.id}`}>
      <Stack gap="subline">
        <div className="hub-card__head">
          <span className="hub-card__title">{org}</span>
          {c.reviewDue < today && <Pill tone="waiting">{englishText("P11.overdueFlag")}</Pill>}
        </div>
        <p className="hub-wrap">{c.body}</p>
        <p className="hub-card__meta">
          {englishText("P11.contact", { role: c.role })} · {c.agreement ? englishText("P11.from", { doc: c.agreement }) : englishText("P11.noDoc")} · {englishText("P11.reviewBy", { date: day(c.reviewDue) })}
        </p>
      </Stack>
    </li>
  );
}

/**
 * "Standing commitments" (P-11, the readiness area's home, 2026-11-07, read-only in this release): what each organisation agreed to do, by
 * disruption type and mode, each naming a role and the agreement it comes from. Reviews that are overdue come first, oldest first; a
 * disruption type nobody committed to is a gap, a decision for the partners and not an error.
 */
export default partnerPage(PARTNER_PAGES.commitments, () => englishText("hub.nav.commitments"), async () => {
  const db = getDb();
  const today = torontoToday(new Date());
  const [commitments, orgs] = await Promise.all([listCommitments(db), listOrgs(db)]);
  const orgName = new Map(orgs.map((org) => [org.id, org.shortName]));
  const overdue = commitments.filter((c) => c.reviewDue < today).sort((a, b) => a.reviewDue.localeCompare(b.reviewDue));
  const next = commitments.filter((c) => c.reviewDue >= today).sort((a, b) => a.reviewDue.localeCompare(b.reviewDue))[0];

  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={englishText("P11.title")} lead={englishText("P11.lead")} area="readiness" />
        <AreaLinks label={englishText("P11.alsoTitle")} links={readinessLinks().slice(1)} />
        <section aria-labelledby="overdue-title" data-testid="commitments-overdue">
          <Stack gap="related">
            <h2 id="overdue-title">{englishText("P11.overdueTitle")}</h2>
            <p>{englishText("P11.overdueLead")}</p>
            {overdue.length === 0 ? (
              <p role="status">{englishText("P11.overdueNone", { date: next ? day(next.reviewDue) : "" })}</p>
            ) : (
              <Stack as="ul" gap="related">
                {overdue.map((c) => (
                  <Commitment key={c.id} c={c} org={orgName.get(c.orgId) ?? c.orgId} today={today} />
                ))}
              </Stack>
            )}
          </Stack>
        </section>
        <section aria-labelledby="table-title" data-testid="commitments-by-type">
          <Stack gap="related">
            <h2 id="table-title">{englishText("P11.tableTitle")}</h2>
            <p>{englishText("P11.tableLead")}</p>
            {READINESS_HAZARDS.map((hazard) => {
              const theirs = commitments.filter((c) => c.hazard === hazard);
              return (
                <section key={hazard} aria-labelledby={`hazard-${hazard}`} className="hub-round" data-testid={`commitments-${hazard}`}>
                  <Stack gap="related">
                    <h3 id={`hazard-${hazard}`}>{hazardWord(hazard)}</h3>
                    {theirs.length === 0 ? (
                      <div className="hub-card hub-card--gap">
                        <Stack gap="subline">
                          <p className="hub-card__title">{englishText("P11.gapTitle", { hazard: hazardWord(hazard) })}</p>
                          <p>{englishText("P11.gapLine")}</p>
                          <p>{englishText("P11.gapQuestion")}</p>
                        </Stack>
                      </div>
                    ) : (
                      MODES.filter((mode) => theirs.some((c) => c.mode === mode)).map((mode) => (
                        <Stack key={mode} gap="subline">
                          <p className="hub-card__title">{englishText(`P11.modes.${mode}`)}</p>
                          <Stack as="ul" gap="related">
                            {theirs
                              .filter((c) => c.mode === mode)
                              .map((c) => (
                                <Commitment key={c.id} c={c} org={orgName.get(c.orgId) ?? c.orgId} today={today} />
                              ))}
                          </Stack>
                        </Stack>
                      ))
                    )}
                  </Stack>
                </section>
              );
            })}
          </Stack>
        </section>
        <p className="hub-flag">{pw("readiness.dummy")}</p>
      </Stack>
    </Screen>
  );
});
