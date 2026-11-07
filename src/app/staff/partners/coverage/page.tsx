import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { COVERAGE_GROUPS, coverageCounts, coverageOf, listCommitments, listOrgs, listSpaces, openSharedSpace, spaceTotals, statementsOf, type CoverageItem } from "@/modules/partners";
import { partnersDb } from "../db";
import { Screen, Stack } from "@/ui";
import { disruptionLinks } from "../area";
import { partnerPage } from "../guarded";
import { AreaHeading, AreaLinks, Pill } from "../parts";
import { PARTNER_PAGES } from "../view";
import { ago, hazardWord, pw } from "../words";

export const metadata: Metadata = { title: englishText("P02.links.coverage") };

/**
 * "Coverage and gaps" (P-04, 2026-11-07): every statement of the open disruption's shared space and every standing commitment for it, sorted by
 * partners' module rule (coverageOf) into not covered, being worked on, waiting on someone and covered, with the counts as tiles and the spaces'
 * totals. Nobody edits this view: it changes when someone posts, takes something on or confirms.
 */
export default partnerPage(PARTNER_PAGES.coverage, () => englishText("P02.links.coverage"), async () => {
  const db = partnersDb();
  const now = new Date();
  const [shared, orgs, commitments, spaces] = await Promise.all([openSharedSpace(db), listOrgs(db), listCommitments(db), listSpaces(db)]);
  const statements = shared ? await statementsOf(db, shared.id) : [];
  const forHazard = shared ? commitments.filter((c) => c.hazard === shared.hazard && c.mode === "during") : [];
  const items = coverageOf(statements, forHazard);
  const counts = coverageCounts(items);
  const orgName = new Map(orgs.map((org) => [org.id, org.shortName]));
  const statementById = new Map(statements.map((s) => [s.id, s]));
  const commitmentById = new Map(forHazard.map((c) => [c.id, c]));
  const totals = spaceTotals(spaces);

  const describe = (item: CoverageItem) => {
    if (item.source === "commitment") {
      const c = commitmentById.get(item.id)!;
      const org = orgName.get(c.orgId) ?? c.orgId;
      const state =
        item.reason === "commitment_confirmed"
          ? pw("coverage.confirmedBy", { org })
          : item.reason === "commitment_declined"
            ? englishText("P04.stateDeclined", { org })
            : englishText("P04.stateUnconfirmed", { org });
      return { text: c.body, kind: englishText("P04.kindCommitment"), by: `${org}, ${c.role}`, state };
    }
    const s = statementById.get(item.id)!;
    const org = orgName.get(s.orgId) ?? s.orgId;
    const state =
      item.reason === "taken"
        ? englishText("P02.takenBy", { org: orgName.get(s.claimedBy ?? "") ?? s.claimedBy ?? "" })
        : item.reason === "offered"
          ? englishText("P04.stateOffer", { org: orgName.get(item.offeredBy ?? "") ?? item.offeredBy ?? "" })
          : item.reason === "offer_standing"
            ? englishText("P04.stateOffer", { org })
            : item.reason === "doing"
              ? englishText("P04.groupLines.covered")
              : englishText("P02.notTaken");
    return { text: s.body, kind: pw(`statement.${s.kind}`), by: `${s.person}, ${org} · ${ago(s.postedAt, now)}`, state };
  };

  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={englishText("P02.links.coverage")} area="disruption" />
        {!shared ? (
          <section className="hub-card">
            <Stack gap="subline">
              <h2>{englishText("P04.noSpaceTitle")}</h2>
              <p>{englishText("P04.noSpaceLine")}</p>
            </Stack>
          </section>
        ) : (
          <>
            <p>
              <strong>
                {hazardWord(shared.hazard)}, {shared.location}.
              </strong>{" "}
              {englishText("P04.assembled", { st: statements.length, cm: forHazard.length, hazard: hazardWord(shared.hazard) })}
            </p>
            <ul className="hub-stats" aria-label={englishText("P04.countsLabel")}>
              {COVERAGE_GROUPS.map((group) => (
                <li key={group} className={`hub-stat${group === "gap" && counts.gap > 0 ? " hub-stat--alert" : ""}`} data-testid={`coverage-count-${group}`}>
                  <span className="hub-stat__n">{counts[group]}</span>
                  <a className="hub-stat__label hub-link" href={`#group-${group}`}>
                    {englishText(`P04.groups.${group}`)}
                  </a>
                </li>
              ))}
            </ul>
            {COVERAGE_GROUPS.map((group) => {
              const inGroup = items.filter((item) => item.group === group);
              return (
                <section key={group} id={`group-${group}`} aria-labelledby={`group-${group}-title`} data-testid={`coverage-${group}`}>
                  <Stack gap="related">
                    <h2 id={`group-${group}-title`} className="hub-wrap">
                      {englishText(`P04.groups.${group}`)}
                    </h2>
                    <p>{englishText(`P04.groupLines.${group}`)}</p>
                    {inGroup.length === 0 ? (
                      <p>{englishText(`P04.emptyGroup.${group}`)}</p>
                    ) : (
                      <Stack as="ul" gap="related">
                        {inGroup.map((item) => {
                          const words = describe(item);
                          return (
                            <li key={item.id} className={`hub-card hub-card--${group}`}>
                              <Stack gap="subline">
                                <div className="hub-card__head">
                                  <Pill tone={group}>{englishText(`P04.groups.${group}`)}</Pill>
                                  <span className="hub-card__meta">{words.kind}</span>
                                </div>
                                <p className="hub-card__title">{words.text}</p>
                                <p className="hub-wrap">{words.state}</p>
                                <p className="hub-card__meta">{words.by}</p>
                              </Stack>
                            </li>
                          );
                        })}
                      </Stack>
                    )}
                  </Stack>
                </section>
              );
            })}
          </>
        )}
        <section aria-labelledby="spaces-title" className="hub-card">
          <Stack gap="subline">
            <h2 id="spaces-title">{englishText("P04.spacesTitle")}</h2>
            <p>{pw("coverage.spaces", { open: totals.byStatus.open, full: totals.byStatus.full, people: totals.peopleNow, max: totals.placesMax })}</p>
            <a className="hub-link" href={PARTNER_PAGES.space}>
              {englishText("P04.toSpace")}
            </a>
          </Stack>
        </section>
        <AreaLinks label={englishText("P02.linksAria")} links={disruptionLinks()} />
      </Stack>
    </Screen>
  );
});
