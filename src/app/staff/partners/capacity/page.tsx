import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { listOrgs, listSpaces, spaceTotals } from "@/modules/partners";
import { getDb } from "@/platform/db";
import { Screen, Stack } from "@/ui";
import { disruptionLinks } from "../area";
import { partnerPage } from "../guarded";
import { AreaHeading, AreaLinks, Pill } from "../parts";
import { PARTNER_PAGES } from "../view";
import { ago, pw } from "../words";

export const metadata: Metadata = { title: englishText("hub.nav.capacity") };

const WORD_KEY = { available: "available", stretched: "stretched", at_capacity: "atCapacity" } as const;
const TONE = { available: "covered", stretched: "waiting", at_capacity: "gap" } as const;

/**
 * "Our capacity" (P-05, 2026-11-07, read-only in this release): what each organisation said about its own capacity (available, stretched, at
 * capacity, or not set), self-declared and never calculated, beside the people in its open spaces against their limits.
 */
export default partnerPage(PARTNER_PAGES.capacity, () => englishText("hub.nav.capacity"), async () => {
  const db = getDb();
  const now = new Date();
  const [orgs, spaces] = await Promise.all([listOrgs(db), listSpaces(db)]);
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={englishText("P05.others")} lead={englishText("P05.othersLine")} area="disruption" />
        <p className="hub-flag">{englishText("P05.selfDeclared")}</p>
        <div className="hub-table-box" tabIndex={0} role="region" aria-label={englishText("P05.others")} data-testid="capacity-table">
          <table className="hub-table">
            <thead>
              <tr>
                <th scope="col">{pw("capacity.org")}</th>
                <th scope="col">{pw("capacity.said")}</th>
                <th scope="col">{pw("capacity.when")}</th>
                <th scope="col" className="hub-table__n">
                  {pw("capacity.inSpaces")}
                </th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => {
                const theirs = spaceTotals(spaces.filter((space) => space.orgId === org.id));
                return (
                  <tr key={org.id} data-testid={`capacity-${org.id}`}>
                    <th scope="row">{org.name}</th>
                    <td>
                      {org.capacity ? (
                        <Pill tone={TONE[org.capacity]}>{englishText(`P05.words.${WORD_KEY[org.capacity]}`)}</Pill>
                      ) : (
                        <Pill tone="not_activated">{englishText("P05.words.notSet")}</Pill>
                      )}
                    </td>
                    <td>{org.capacitySetAt ? ago(org.capacitySetAt, now) : englishText("P05.notSetLine", { org: org.shortName })}</td>
                    <td className="hub-table__n">{theirs.placesMax > 0 ? englishText("P04.spaceCap", { now: theirs.peopleNow, max: theirs.placesMax }) : pw("capacity.noSpace")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="hub-stats" aria-label={englishText("P05.lines.available")}>
          {(["available", "stretched", "atCapacity", "notSet"] as const).map((word) => (
            <li key={word} className="hub-stat">
              <span className="hub-stat__label">
                <strong>{englishText(`P05.words.${word}`)}</strong>: {englishText(`P05.lines.${word}`)}
              </span>
            </li>
          ))}
        </ul>
        <AreaLinks label={englishText("P02.linksAria")} links={disruptionLinks()} />
      </Stack>
    </Screen>
  );
});
