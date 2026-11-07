import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { can } from "@/modules/identity";
import { listCommitments, listOrgs, listSpaces, handoversOf, openSharedSpace, spaceTotals, statementsOf } from "@/modules/partners";
import { partnersDb } from "./db";
import { Screen, Stack } from "@/ui";
import { disruptionActions, disruptionLinks } from "./area";
import { partnerPage } from "./guarded";
import { AreaHeading, AreaLinks, ChangeNoticeLine, Pill, SpaceCard } from "./parts";
import { PARTNER_PAGES, changeNotice, spaceView } from "./view";
import { ago, hazardWord, pw } from "./words";

export const metadata: Metadata = { title: englishText("hub.nav.space") };

type Query = { space?: string | string[]; done?: string | string[]; error?: string | string[] };

/** The tone of a standing commitment's answer for this disruption: confirmed is covered, declined a gap, no answer yet waiting. */
const COMMITMENT_TONE = { confirmed: "covered", declined: "gap", pending: "waiting" } as const;

/**
 * "Shared space" (P-02, the partner space of 2026-11-07): the open disruption and what its space is for, the status board of every space (open,
 * full, closed or not activated, how full, and who confirmed it when), the standing commitments for the disruption with each organisation's
 * answer, the latest handover, and the statements partners posted, newest first. A Coordinator or an Admin changes a space from its page (P-06)
 * or opens one (P-01); a Director reads. Read for each request (no-store).
 */
export default partnerPage<{ searchParams?: Promise<Query> }>(PARTNER_PAGES.space, () => englishText("hub.nav.space"), async (session, { searchParams }) => {
  const db = partnersDb();
  const now = new Date();
  const [spaces, shared, orgs, commitments] = await Promise.all([listSpaces(db), openSharedSpace(db), listOrgs(db), listCommitments(db)]);
  const [statements, handovers] = shared ? await Promise.all([statementsOf(db, shared.id), handoversOf(db, shared.id)]) : [[], []];
  const orgName = new Map(orgs.map((org) => [org.id, org.shortName]));
  const notice = changeNotice((await searchParams) ?? {}, spaces, now);
  const totals = spaceTotals(spaces);
  const canUpdate = can(session.role, "space.update");
  const forHazard = shared ? commitments.filter((c) => c.hazard === shared.hazard && c.mode === "during") : [];
  const latest = handovers[0];
  const statementText = new Map(statements.map((s) => [s.id, s.body]));

  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={englishText("hub.nav.space")} area="disruption" />
        <ChangeNoticeLine notice={notice} />
        {shared ? (
          <section aria-label={englishText("P02.headAria")} className="hub-card hub-card--open" data-testid="shared-space-head">
            <Stack gap="subline">
              <div className="hub-card__head">
                <span className="hub-card__title">
                  {hazardWord(shared.hazard)}, {shared.location}
                </span>
                <Pill tone="full">{englishText("P02.level", { n: shared.level })}</Pill>
              </div>
              <p className="hub-card__meta">
                {pw("head.opened", { by: shared.openedBy, t: ago(shared.openedAt, now) })}
              </p>
              <p>
                <strong>{englishText("P02.purpose")}:</strong> {englishText(`P02.purposes.${shared.purpose}.label`)}. {englishText(`P02.purposes.${shared.purpose}.line`)}
              </p>
              <p className="hub-card__meta">
                {englishText("P02.notFor")} {englishText("P02.whoSees")}
              </p>
            </Stack>
          </section>
        ) : (
          <section className="hub-card" data-testid="shared-space-none">
            <Stack gap="subline">
              <h2 className="hub-wrap">{englishText("P02.noneTitle")}</h2>
              <p>{englishText("P02.noneLine")}</p>
            </Stack>
          </section>
        )}
        <AreaLinks label={englishText("P02.linksAria")} links={[...disruptionLinks().slice(1), ...(canUpdate ? disruptionActions() : disruptionActions().slice(1))]} />

        <section aria-labelledby="board-title" data-testid="space-board">
          <Stack gap="related">
            <h2 id="board-title" className="hub-wrap">
              {englishText("P04.spacesTitle")}
            </h2>
            <p>{englishText("P04.spacesLine")}</p>
            <ul className="hub-stats" aria-label={pw("board.countsLabel")}>
              {(["open", "full", "closed", "not_activated"] as const).map((status) => (
                <li key={status} className={`hub-stat${status === "full" && totals.byStatus.full > 0 ? " hub-stat--alert" : ""}`} data-testid={`count-${status}`}>
                  <span className="hub-stat__n">{totals.byStatus[status]}</span>
                  <span className="hub-stat__label">{pw(`status.${status}`)}</span>
                </li>
              ))}
              <li className="hub-stat" data-testid="count-people">
                <span className="hub-stat__n">{totals.peopleNow}</span>
                <span className="hub-stat__label">{pw("board.peopleOf", { max: totals.placesMax })}</span>
              </li>
            </ul>
            {spaces.length === 0 ? (
              <p>{pw("board.none")}</p>
            ) : (
              <Stack as="ul" gap="related">
                {spaces.map((space) => (
                  <SpaceCard key={space.id} view={spaceView(space, now)}>
                    {canUpdate && (
                      <a className="tap hub-button hub-button--secondary hub-esc__open" href={spaceView(space, now).href} data-testid={`change-${space.id}`}>
                        {pw("board.change", { name: space.name })}
                      </a>
                    )}
                  </SpaceCard>
                ))}
              </Stack>
            )}
          </Stack>
        </section>

        {shared && (
          <section aria-labelledby="commitments-title" data-testid="space-commitments">
            <Stack gap="related">
              <h2 id="commitments-title" className="hub-wrap">
                {englishText("P02.comTitle", { hazard: hazardWord(shared.hazard) })}
              </h2>
              <p>{englishText("P02.comLine")}</p>
              {forHazard.length === 0 ? (
                <p className="hub-flag">{englishText("P02.comGap", { hazard: englishText(`P02.plural.${shared.hazard}`) })}</p>
              ) : (
                <Stack as="ul" gap="related">
                  {forHazard.map((c) => {
                    const answer = c.forDisruption ?? "pending";
                    const tone = COMMITMENT_TONE[answer];
                    return (
                      <li key={c.id} className={`hub-card hub-card--${tone}`} data-testid={`commitment-${c.id}`}>
                        <Stack gap="subline">
                          <div className="hub-card__head">
                            <span className="hub-card__title">{orgName.get(c.orgId) ?? c.orgId}</span>
                            <Pill tone={answer}>{englishText(answer === "confirmed" ? "P02.comConfirmed" : answer === "declined" ? "P02.comDeclined" : "P02.comPending")}</Pill>
                          </div>
                          <p className="hub-wrap">{c.body}</p>
                          <p className="hub-card__meta">{englishText("P02.comMeta", { role: c.role, agreement: c.agreement ?? englishText("P02.comNoAgreement") })}</p>
                        </Stack>
                      </li>
                    );
                  })}
                </Stack>
              )}
            </Stack>
          </section>
        )}

        {latest && (
          <section aria-labelledby="handover-title" className="hub-card hub-card--waiting" data-testid="latest-handover">
            <Stack gap="subline">
              <h2 id="handover-title" className="hub-wrap">
                {englishText("P02.latestHandover")}
              </h2>
              <p className="hub-card__meta">
                {latest.toPerson ? englishText("P02.hoFromTo", { from: latest.fromPerson, to: latest.toPerson }) : englishText("P02.hoToNobody", { from: latest.fromPerson })} ·{" "}
                {ago(latest.handedAt, now)}
              </p>
              <p className="hub-wrap">{latest.note}</p>
              {latest.openItems.length > 0 && <p className="hub-wrap">{englishText("P02.hoOpen", { list: latest.openItems.map((id) => statementText.get(id) ?? id).join(" · ") })}</p>}
            </Stack>
          </section>
        )}

        {shared && (
          <section aria-labelledby="stream-title" data-testid="space-stream">
            <Stack gap="related">
              <h2 id="stream-title" className="hub-wrap">
                {englishText("P02.streamTitle")}
              </h2>
              <p>
                <small>{pw("board.dummy")}</small>
              </p>
              <Stack as="ul" gap="related">
                {statements.map((s) => (
                  <li key={s.id} className={`hub-card hub-card--${s.kind === "doing" ? "covered" : s.kind === "need" || s.kind === "cannot_cover" ? (s.claimedBy ? "working" : "gap") : "waiting"}`} data-testid={`statement-${s.id}`}>
                    <Stack gap="subline">
                      <div className="hub-card__head">
                        <Pill tone={s.kind === "doing" ? "covered" : s.kind === "can_take" ? "waiting" : "gap"}>{pw(`statement.${s.kind}`)}</Pill>
                        <span className="hub-card__meta">{ago(s.postedAt, now)}</span>
                      </div>
                      <p className="hub-wrap">{s.body}</p>
                      <p className="hub-card__meta">
                        {s.person}, {orgName.get(s.orgId) ?? s.orgId}
                        {s.claimedBy ? ` · ${englishText("P02.takenBy", { org: orgName.get(s.claimedBy) ?? s.claimedBy })}` : ""}
                        {s.answers && statementText.has(s.answers) ? ` · ${englishText("P02.answers", { what: statementText.get(s.answers)! })}` : ""}
                      </p>
                    </Stack>
                  </li>
                ))}
              </Stack>
            </Stack>
          </section>
        )}
        <p>
          <a className="hub-link" href={PARTNER_PAGES.commitments}>
            {englishText("hub.sections.between")}: {englishText("hub.nav.commitments")}
          </a>
        </p>
      </Stack>
    </Screen>
  );
});
