import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { listIndicators } from "@/modules/partners";
import { partnersDb } from "../../partners/db";
import { Screen, Stack } from "@/ui";
import { readinessLinks } from "../../partners/area";
import { partnerPage } from "../../partners/guarded";
import { AreaHeading, AreaLinks } from "../../partners/parts";
import { PARTNER_PAGES } from "../../partners/view";
import { pw } from "../../partners/words";

export const metadata: Metadata = { title: englishText("hub.nav.indicators") };

/** The indicators the prototype names (P15.ind.*); a row the seed adds with another id is shown by its id. */
const NAMED = new Set(["reach", "unreachable", "timeToAck", "stale", "directory", "rounds", "everydayUse", "smallNumber", "trust"]);

/**
 * "Indicators" (P-15, 2026-11-07, read-only, dummy figures): is the CVH reaching people and being kept current. Counts and rates only, real
 * disruptions, exercises and everyday use in columns that are never added together, and every figure under 5 shown as "Fewer than 5".
 */
export default partnerPage(PARTNER_PAGES.indicators, () => englishText("hub.nav.indicators"), async () => {
  const indicators = await listIndicators(partnersDb());
  const cell = (value: string | null) => value ?? englishText("P15.na");
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={englishText("P15.title")} lead={englishText("P15.lead")} area="readiness" />
        <p className="hub-flag">{englishText("P15.privacy")}</p>
        <p className="hub-flag">{pw("readiness.dummy")}</p>
        <div className="hub-table-box" tabIndex={0} role="region" aria-label={englishText("P15.tilesTitle")} data-testid="indicators-table">
          <table className="hub-table">
            <thead>
              <tr>
                <th scope="col">{englishText("P15.tilesTitle")}</th>
                <th scope="col">{englishText("P15.colReal")}</th>
                <th scope="col">{englishText("P15.colExercise")}</th>
                <th scope="col">{englishText("P15.colEveryday")}</th>
              </tr>
            </thead>
            <tbody>
              {indicators.map((ind) => (
                <tr key={ind.id} data-testid={`indicator-${ind.id}`}>
                  <th scope="row">
                    <Stack gap="subline">
                      <span>{NAMED.has(ind.id) ? englishText(`P15.ind.${ind.id}.name`) : ind.id}</span>
                      {NAMED.has(ind.id) && <small className="hub-card__meta">{englishText(`P15.ind.${ind.id}.def`)}</small>}
                    </Stack>
                  </th>
                  <td>{cell(ind.realValue)}</td>
                  <td>{cell(ind.exerciseValue)}</td>
                  <td>{cell(ind.everydayValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <section aria-labelledby="rules-title" className="hub-card">
          <Stack gap="subline">
            <h2 id="rules-title">{englishText("P15.showDefs")}</h2>
            <ul>
              {[0, 1, 2, 3].map((at) => (
                <li key={at}>{englishText(`P15.rules.${at}`)}</li>
              ))}
            </ul>
          </Stack>
        </section>
        <AreaLinks label={englishText("P11.alsoTitle")} links={readinessLinks()} />
      </Stack>
    </Screen>
  );
});
