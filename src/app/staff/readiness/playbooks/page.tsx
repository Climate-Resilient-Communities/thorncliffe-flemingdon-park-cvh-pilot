import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { listOrgs, listPlaybooks } from "@/modules/partners";
import { partnersDb } from "../../partners/db";
import { Screen, Stack } from "@/ui";
import { readinessLinks } from "../../partners/area";
import { partnerPage } from "../../partners/guarded";
import { AreaHeading, AreaLinks, Pill } from "../../partners/parts";
import { PARTNER_PAGES } from "../../partners/view";
import { day, duration, hazardWord, pw } from "../../partners/words";

export const metadata: Metadata = { title: englishText("hub.nav.playbooks") };

/** The alert templates the prototype names (P12.tpl.*); any other is shown by its id. */
const NAMED_TEMPLATES = new Set(["TPL-ACK-POWER", "TPL-ACK-ELEVATOR", "TPL-ACK-FLOOD"]);

const STATE_TONE = { agreed: "covered", proposed: "waiting", placeholder: "gap" } as const;

/**
 * "Playbooks" (P-12, 2026-11-07, read-only in this release): one playbook per disruption type, agreed, proposed or a placeholder. The chosen one
 * (?hazard=, the first by default) shows its settings, the four parts of day one (who is activated, which spaces open, which templates, what is
 * asked of each partner), its day-one checklist (the steps a shared space loads) and its version history.
 */
export default partnerPage<{ searchParams?: Promise<{ hazard?: string | string[] }> }>(PARTNER_PAGES.playbooks, () => englishText("hub.nav.playbooks"), async (_session, { searchParams }) => {
  const db = partnersDb();
  const [playbooks, orgs] = await Promise.all([listPlaybooks(db), listOrgs(db)]);
  const asked = (await searchParams)?.hazard;
  const chosen = playbooks.find((p) => p.hazard === asked) ?? playbooks.find((p) => p.state === "agreed") ?? playbooks[0];
  const orgName = new Map(orgs.map((org) => [org.id, org.shortName]));
  const stateWord = (p: (typeof playbooks)[number]) => englishText(`P12.state.${p.state}`, { v: p.version ?? "" });
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={englishText("P12.title")} lead={englishText("P12.lead")} area="readiness" />
        <nav aria-label={englishText("P12.listLabel")}>
          <ul className="hub-actions">
            {playbooks.map((p) => (
              <li key={p.hazard}>
                <a
                  className={`tap hub-button ${p.hazard === chosen?.hazard ? "hub-button--primary" : "hub-button--secondary"}`}
                  href={`${PARTNER_PAGES.playbooks}?hazard=${p.hazard}`}
                  aria-current={p.hazard === chosen?.hazard ? "page" : undefined}
                >
                  {hazardWord(p.hazard)}: {stateWord(p)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {chosen && (
          <section aria-labelledby="playbook-title" className={`hub-card hub-card--${STATE_TONE[chosen.state]}`} data-testid={`playbook-${chosen.hazard}`}>
            <Stack gap="related">
              <div className="hub-card__head">
                <h2 id="playbook-title">{englishText("P12.playbookFor", { hazard: hazardWord(chosen.hazard) })}</h2>
                <Pill tone={STATE_TONE[chosen.state]}>{stateWord(chosen)}</Pill>
              </div>
              {chosen.state === "agreed" && chosen.agreedOn && <p>{englishText("P12.version", { v: chosen.version ?? "", date: day(chosen.agreedOn) })}</p>}
              {chosen.state === "proposed" && <p className="hub-flag">{englishText("P12.proposedLine")}</p>}
              {chosen.state === "placeholder" && (
                <p className="hub-flag">
                  <span className="hub-flag__label">{englishText("P12.placeholderTitle")}.</span> {englishText("P12.placeholderLine")}
                </p>
              )}
              <h3>{englishText("P12.settingsTitle")}</h3>
              <ul className="hub-stats">
                <li className="hub-stat">
                  <span className="hub-stat__n">{duration(chosen.staleAfterMins * 60_000)}</span>
                  <span className="hub-stat__label">{englishText("P12.staleLine")}</span>
                </li>
                <li className="hub-stat">
                  <span className="hub-stat__label">
                    <strong>{englishText(`P12.post${chosen.ambassadorPosting === "direct" ? "Direct" : chosen.ambassadorPosting === "hub" ? "Hub" : "None"}`)}</strong>.{" "}
                    {englishText(`P12.post${chosen.ambassadorPosting === "direct" ? "Direct" : chosen.ambassadorPosting === "hub" ? "Hub" : "None"}Line`)}
                  </span>
                </li>
              </ul>
              {chosen.state !== "placeholder" && (
                <>
                  <h3>{englishText(chosen.state === "proposed" ? "P12.partsTitleProposed" : "P12.partsTitle")}</h3>
                  <div className="hub-table-box" tabIndex={0} role="region" aria-label={englishText("P12.partsTitle")}>
                    <table className="hub-table">
                      <tbody>
                        <tr>
                          <th scope="row">{englishText("P12.p1")}</th>
                          <td>{chosen.activated.join("; ")}</td>
                        </tr>
                        <tr>
                          <th scope="row">{englishText("P12.p2")}</th>
                          <td>{chosen.spaces.join("; ") || englishText("P11.none")}</td>
                        </tr>
                        <tr>
                          <th scope="row">{englishText("P12.p3")}</th>
                          <td>{chosen.templates.map((id) => (NAMED_TEMPLATES.has(id) ? englishText(`P12.tpl.${id}`) : id)).join("; ") || englishText("P11.none")}</td>
                        </tr>
                        <tr>
                          <th scope="row">{englishText("P12.p4")}</th>
                          <td>
                            <ul>
                              {Object.entries(chosen.asks).map(([org, ask]) => (
                                <li key={org}>
                                  <strong>{orgName.get(org) ?? org}:</strong> {ask}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <h3>{englishText(chosen.state === "proposed" ? "P12.checklistTitleProposed" : "P12.checklistTitle")}</h3>
                  <p>{englishText("P12.checklistLead")}</p>
                  <ol className="hub-progress" data-testid="playbook-steps">
                    {chosen.steps.map((step, at) => (
                      <li key={step} className="hub-progress__step hub-progress__step--done">
                        <span className="hub-progress__n">{at + 1}</span> {step}
                      </li>
                    ))}
                  </ol>
                  <p>
                    <small>{englishText("P12.adjustNote")}</small>
                  </p>
                </>
              )}
              <h3>{englishText("P12.historyTitle")}</h3>
              {chosen.history.length === 0 ? (
                <p>{englishText("P12.noHistory")}</p>
              ) : (
                <div className="hub-table-box" tabIndex={0} role="region" aria-label={englishText("P12.historyTitle")}>
                  <table className="hub-table">
                    <thead>
                      <tr>
                        <th scope="col">{pw("playbooks.version")}</th>
                        <th scope="col">{pw("playbooks.date")}</th>
                        <th scope="col">{pw("playbooks.by")}</th>
                        <th scope="col">{pw("playbooks.change")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chosen.history.map((v) => (
                        <tr key={v.version}>
                          <td>{v.version}</td>
                          <td>{day(v.date)}</td>
                          <td>{v.by}</td>
                          <td>{v.change}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Stack>
          </section>
        )}
        <AreaLinks label={englishText("P11.alsoTitle")} links={readinessLinks()} />
      </Stack>
    </Screen>
  );
});
