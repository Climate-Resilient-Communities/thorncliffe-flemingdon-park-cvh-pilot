import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { listTeams } from "@/modules/partners";
import { partnersDb } from "../../partners/db";
import { Screen, Stack } from "@/ui";
import { readinessLinks } from "../../partners/area";
import { partnerPage } from "../../partners/guarded";
import { AreaHeading, AreaLinks, Pill } from "../../partners/parts";
import { PARTNER_PAGES } from "../../partners/view";
import { hazardWord } from "../../partners/words";

export const metadata: Metadata = { title: englishText("hub.nav.teams") };

/**
 * "Teams and triggers" (P-13, 2026-11-07, read-only in this release): who is activated for each disruption type and level, how they are
 * reached and the event that starts it, each team a role and never a person. A level with no team is a gap to decide, shown as one.
 */
export default partnerPage(PARTNER_PAGES.teams, () => englishText("hub.nav.teams"), async () => {
  const teams = await listTeams(partnersDb());
  const hazards = [...new Set(teams.map((t) => t.hazard))];
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={englishText("P13.title")} lead={englishText("P13.lead")} area="readiness" />
        <section aria-labelledby="how-title" className="hub-card hub-card--waiting">
          <Stack gap="subline">
            <h2 id="how-title">{englishText("P13.howTitle")}</h2>
            <ol>
              {(["how1", "how2", "how3"] as const).map((key) => (
                <li key={key}>{englishText(`P13.${key}`)}</li>
              ))}
            </ol>
          </Stack>
        </section>
        <section aria-labelledby="grid-title">
          <Stack gap="related">
            <h2 id="grid-title">{englishText("P13.gridTitle")}</h2>
            <div className="hub-table-box" tabIndex={0} role="region" aria-labelledby="grid-title" data-testid="teams-grid">
              <table className="hub-table">
                <thead>
                  <tr>
                    <th scope="col">{englishText("P13.typeCol")}</th>
                    <th scope="col">{englishText("P13.levels.1")}</th>
                    <th scope="col">{englishText("P13.levels.2")}</th>
                  </tr>
                </thead>
                <tbody>
                  {hazards.map((hazard) => (
                    <tr key={hazard} data-testid={`teams-${hazard}`}>
                      <th scope="row">{hazardWord(hazard)}</th>
                      {[1, 2].map((level) => {
                        const cell = teams.find((t) => t.hazard === hazard && t.level === level);
                        return (
                          <td key={level}>
                            {cell?.team ? (
                              <Stack gap="subline">
                                <span className="hub-card__title">{cell.team}</span>
                                <span>
                                  {englishText("P13.channels")}: {cell.channels.map((c) => englishText(`P13.chan.${c}`)).join(", ")}
                                </span>
                                {cell.triggerEvent && (
                                  <span className="hub-card__meta">
                                    {englishText("P13.trigger")}: {cell.triggerEvent}
                                  </span>
                                )}
                              </Stack>
                            ) : (
                              <Stack gap="subline">
                                <Pill tone="gap">{englishText("P13.gapTitle")}</Pill>
                                <span>{englishText("P13.gapLine")}</span>
                              </Stack>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Stack>
        </section>
        <AreaLinks label={englishText("P11.alsoTitle")} links={readinessLinks()} />
      </Stack>
    </Screen>
  );
});
