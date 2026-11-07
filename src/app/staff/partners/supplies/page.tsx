import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { listOrgs, listSupplies } from "@/modules/partners";
import { getDb } from "@/platform/db";
import { Screen, Stack } from "@/ui";
import { disruptionLinks } from "../area";
import { partnerPage } from "../guarded";
import { AreaHeading, AreaLinks, Pill } from "../parts";
import { PARTNER_PAGES } from "../view";
import { ago, pw } from "../words";

export const metadata: Metadata = { title: englishText("hub.nav.supplies") };

/** The prototype's item keys (P08.items.*) for the database's words. */
const ITEM_KEY: Record<string, string> = { power_banks: "powerBanks", box_fans: "boxFans" };
const QTY_TONE = { few: "waiting", some: "working", plenty: "covered" } as const;

/**
 * "Supplies" (P-08, 2026-11-07, read-only in this release): what each organisation holds, where and roughly how much, with when it was last
 * updated, one table per organisation. Partners only: residents never see this list.
 */
export default partnerPage(PARTNER_PAGES.supplies, () => englishText("hub.nav.supplies"), async () => {
  const db = getDb();
  const now = new Date();
  const [orgs, supplies] = await Promise.all([listOrgs(db), listSupplies(db)]);
  const holding = orgs.filter((org) => supplies.some((s) => s.orgId === org.id));
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={englishText("P08.title")} lead={englishText("P08.lead")} area="disruption" />
        <p className="hub-flag">{englishText("P08.partnerOnly")}</p>
        {holding.map((org) => (
          <section key={org.id} aria-labelledby={`supplies-${org.id}`} data-testid={`supplies-${org.id}`}>
            <Stack gap="related">
              <h2 id={`supplies-${org.id}`} className="hub-wrap">
                {org.name}
              </h2>
              <div className="hub-table-box" tabIndex={0} role="region" aria-labelledby={`supplies-${org.id}`}>
                <table className="hub-table">
                  <thead>
                    <tr>
                      <th scope="col">{englishText("P08.what")}</th>
                      <th scope="col">{englishText("P08.howMuch")}</th>
                      <th scope="col">{englishText("P08.where")}</th>
                      <th scope="col">{pw("supplies.updated")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplies
                      .filter((s) => s.orgId === org.id)
                      .map((s) => (
                        <tr key={s.id}>
                          <th scope="row">{englishText(`P08.items.${ITEM_KEY[s.item] ?? s.item}`)}</th>
                          <td>
                            <Pill tone={QTY_TONE[s.qty]}>{englishText(`P08.qty.${s.qty}`)}</Pill> {s.qtyNum !== null ? englishText("P08.about", { n: s.qtyNum, unit: s.unit }) : s.unit}
                          </td>
                          <td>{s.location}</td>
                          <td>{ago(s.updatedAt, now)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Stack>
          </section>
        ))}
        <AreaLinks label={englishText("P02.linksAria")} links={disruptionLinks()} />
      </Stack>
    </Screen>
  );
});
