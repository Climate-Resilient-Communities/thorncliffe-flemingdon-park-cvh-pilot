import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { can } from "@/modules/identity";
import { readSpace } from "@/modules/partners";
import { partnersDb } from "../../db";
import { Screen, Stack } from "@/ui";
import { disruptionLinks } from "../../area";
import { partnerPage } from "../../guarded";
import { AreaHeading, AreaLinks, ChangeNoticeLine, Pill, QuickStatus, SpaceCard, SpaceForm } from "../../parts";
import { PARTNER_PAGES, changeNotice, purposeLabel, spacePage, spaceView, statusLabel } from "../../view";
import { ago, clock, pw } from "../../words";

export const metadata: Metadata = { title: englishText("staff.partners.activation.title") };

type Props = { params?: Promise<{ id: string }>; searchParams?: Promise<{ space?: string | string[]; done?: string | string[]; error?: string | string[] }> };

/**
 * A space's activation (P-06 as the product owner scoped it on 2026-11-07: set a space's status, purpose and capacity, audited). The space as
 * it stands, what residents see of it now, the form a Coordinator or an Admin changes it with (saving confirms it as it stands, as their Hub
 * account), the one-tap buttons of P-07, and its changes, newest first. A Director reads it all without the forms.
 */
export default partnerPage<Props>("/staff/partners/spaces/[id]", () => pw("activation.title"), async (session, { params, searchParams }) => {
  // A page called without its segment (a test calling it directly) reads as a space that is not there.
  const { id } = (await params) ?? { id: "" };
  const now = new Date();
  const read = /^SP[0-9]{2,4}$/.test(id) ? await readSpace(partnersDb(), id) : null;
  if (!read) {
    return (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <AreaHeading title={pw("activation.title")} area="disruption" />
          <p role="alert" className="hub-error" data-testid="space-missing">
            {pw("errors.not_found")}
          </p>
          <AreaLinks label={englishText("P02.linksAria")} links={disruptionLinks()} />
        </Stack>
      </Screen>
    );
  }
  const { space, changes } = read;
  const view = spaceView(space, now);
  const notice = changeNotice((await searchParams) ?? {}, [space], now);
  const canUpdate = can(session.role, "space.update");
  const back = spacePage(space.id);
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={space.name} lead={pw("activation.lead")} area="disruption" />
        <ChangeNoticeLine notice={notice} />
        <Stack as="ul" gap="related">
          <SpaceCard view={view}>{canUpdate && <QuickStatus space={view} back={back} />}</SpaceCard>
        </Stack>
        <section aria-labelledby="residents-title" className={`hub-card hub-card--${view.shown ? space.status : "closed"}`} data-testid="residents-see">
          <Stack gap="subline">
            <h2 id="residents-title" className="hub-wrap">
              {englishText("P07.residentsTitle")}
            </h2>
            <p>{englishText("P07.residentsLine")}</p>
            {view.shown && space.providerId ? (
              <p className="hub-actions">
                <Pill tone={space.status}>{englishText(`x09.${space.status}`)}</Pill>
                <span>{englishText("R14.spaceFor", { purpose: englishText(`x09.purpose.${space.purpose === "clean_air" ? "cleanAir" : space.purpose}`) })}</span>
              </p>
            ) : (
              <p>{space.providerId ? pw("activation.notShown") : pw("activation.noPlace")}</p>
            )}
          </Stack>
        </section>
        {canUpdate ? (
          <section aria-labelledby="change-title">
            <Stack gap="related">
              <h2 id="change-title" className="hub-wrap">
                {pw("activation.changeTitle")}
              </h2>
              <p>{englishText("P07.lead")}</p>
              <SpaceForm space={space} back={back} />
            </Stack>
          </section>
        ) : (
          <p className="hub-flag">{pw("errors.readOnly")}</p>
        )}
        <section aria-labelledby="history-title" data-testid="space-history">
          <Stack gap="related">
            <h2 id="history-title" className="hub-wrap">
              {pw("activation.historyTitle")}
            </h2>
            {changes.length === 0 ? (
              <p>{pw("activation.noHistory")}</p>
            ) : (
              <div className="hub-table-box" tabIndex={0} role="region" aria-labelledby="history-title">
                <table className="hub-table">
                  <thead>
                    <tr>
                      <th scope="col">{pw("activation.when")}</th>
                      <th scope="col">{englishText("P07.state")}</th>
                      <th scope="col">{pw("form.purpose")}</th>
                      <th scope="col" className="hub-table__n">
                        {englishText("P07.capacity")}
                      </th>
                      <th scope="col">{pw("activation.by")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((change) => (
                      <tr key={change.at.toISOString() + change.status}>
                        <td>
                          {clock(change.at)} ({ago(change.at, now)})
                        </td>
                        <td>
                          <Pill tone={change.status}>{statusLabel(change.status)}</Pill>
                        </td>
                        <td>{purposeLabel(change.purpose)}</td>
                        <td className="hub-table__n">{change.capacityNow === null ? englishText("P07.capUnknown") : englishText("P04.spaceCap", { now: change.capacityNow, max: change.capacityMax })}</td>
                        <td>{change.by}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Stack>
        </section>
        <AreaLinks label={englishText("P02.linksAria")} links={[{ href: PARTNER_PAGES.space, label: englishText("hub.nav.space") }, { href: `${PARTNER_PAGES.ourSpaces}?org=${space.orgId}`, label: englishText("P07.title", { org: space.orgShortName }) }]} />
      </Stack>
    </Screen>
  );
});
