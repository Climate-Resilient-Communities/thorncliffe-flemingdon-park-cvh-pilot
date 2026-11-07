import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { can } from "@/modules/identity";
import { listOrgs, listSpaces } from "@/modules/partners";
import { getDb } from "@/platform/db";
import { Screen, Stack } from "@/ui";
import { disruptionLinks } from "../area";
import { partnerPage } from "../guarded";
import { AreaHeading, AreaLinks, ChangeNoticeLine, QuickStatus, SpaceCard } from "../parts";
import { PARTNER_PAGES, changeNotice, spaceView } from "../view";
import { pw } from "../words";

export const metadata: Metadata = { title: englishText("hub.nav.ourSpaces") };

type Query = { org?: string | string[]; space?: string | string[]; done?: string | string[]; error?: string | string[] };

/**
 * "Our spaces" (P-07, 2026-11-07): the spaces one organisation runs, open, full or closed in one tap, and "Still correct" to confirm one as it
 * stands. Partner staff have no accounts of their own yet, so a Hub account chooses whose spaces to show (?org=, the Hub's by default) and acts
 * for that organisation; the space is then "confirmed by" that Hub account. The change reaches the resident map and listing at the same moment.
 */
export default partnerPage<{ searchParams?: Promise<Query> }>(PARTNER_PAGES.ourSpaces, () => englishText("hub.nav.ourSpaces"), async (session, { searchParams }) => {
  const db = getDb();
  const now = new Date();
  const query = (await searchParams) ?? {};
  const [orgs, spaces] = await Promise.all([listOrgs(db), listSpaces(db)]);
  const running = orgs.filter((org) => spaces.some((space) => space.orgId === org.id));
  const asked = typeof query.org === "string" ? query.org : "";
  const org = running.find((o) => o.id === asked) ?? running[0];
  const theirs = org ? spaces.filter((space) => space.orgId === org.id) : [];
  const notice = changeNotice(query, spaces, now);
  const canUpdate = can(session.role, "space.update");
  const back = org ? `${PARTNER_PAGES.ourSpaces}?org=${org.id}` : PARTNER_PAGES.ourSpaces;
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={org ? englishText("P07.title", { org: org.shortName }) : englishText("hub.nav.ourSpaces")} lead={englishText("P07.lead")} area="disruption" />
        <ChangeNoticeLine notice={notice} />
        <nav aria-label={pw("ourSpaces.whose")}>
          <Stack gap="subline">
            <p className="hub-card__title">{pw("ourSpaces.whose")}</p>
            <ul className="hub-actions">
              {running.map((o) => (
                <li key={o.id}>
                  <a
                    className={`tap hub-button ${o.id === org?.id ? "hub-button--primary" : "hub-button--secondary"}`}
                    href={`${PARTNER_PAGES.ourSpaces}?org=${o.id}`}
                    aria-current={o.id === org?.id ? "page" : undefined}
                  >
                    {o.shortName}
                  </a>
                </li>
              ))}
            </ul>
            <p>
              <small>{pw("ourSpaces.actingFor")}</small>
            </p>
          </Stack>
        </nav>
        {org && <p>{englishText("P07.onlyOwn", { org: org.shortName })}</p>}
        {!canUpdate && <p className="hub-flag">{pw("errors.readOnly")}</p>}
        {theirs.length === 0 ? (
          <p>{englishText("P07.none", { org: org?.shortName ?? "" })}</p>
        ) : (
          <Stack as="ul" gap="related">
            {theirs.map((space) => {
              const view = spaceView(space, now);
              return (
                <SpaceCard key={space.id} view={view}>
                  {canUpdate && <QuickStatus space={view} back={back} />}
                </SpaceCard>
              );
            })}
          </Stack>
        )}
        <AreaLinks label={englishText("P02.linksAria")} links={disruptionLinks()} />
      </Stack>
    </Screen>
  );
});
