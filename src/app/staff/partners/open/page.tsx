import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { can } from "@/modules/identity";
import { isResidentStatus, listSpaces } from "@/modules/partners";
import { partnersDb } from "../db";
import { Screen, Stack } from "@/ui";
import { disruptionLinks } from "../area";
import { partnerPage } from "../guarded";
import { AreaHeading, AreaLinks, ChangeNoticeLine, SpaceCard, SpaceForm } from "../parts";
import { PARTNER_PAGES, changeNotice, spaceView } from "../view";
import { pw } from "../words";

export const metadata: Metadata = { title: englishText("staff.partners.open.title") };

type Query = { space?: string | string[]; done?: string | string[]; error?: string | string[] };

/**
 * "Open a space" (P-01, as the product owner scoped it on 2026-11-07: the prototype's P-01 opened the coordination space from a disruption; the
 * pilot's opens a room for residents). Every space that is not open or full, each with the form that opens it: what it is for, the room's
 * limit and, if someone has counted, the people there now. Opening confirms it as the person who opened it, and residents see it on the map
 * and the listing at once. A Director reads the list without the forms (`space.update`, which each action asks again on its own).
 */
export default partnerPage<{ searchParams?: Promise<Query> }>(PARTNER_PAGES.open, () => pw("open.title"), async (session, { searchParams }) => {
  const now = new Date();
  const spaces = await listSpaces(partnersDb());
  const notice = changeNotice((await searchParams) ?? {}, spaces, now);
  const closed = spaces.filter((space) => !isResidentStatus(space.status));
  const canUpdate = can(session.role, "space.update");
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={pw("open.title")} lead={pw("open.lead")} area="disruption" />
        <ChangeNoticeLine notice={notice} />
        {!canUpdate && <p className="hub-flag">{pw("errors.readOnly")}</p>}
        {closed.length === 0 ? (
          <p role="status" data-testid="open-none">
            {pw("open.none")}
          </p>
        ) : (
          <Stack as="ul" gap="related">
            {closed.map((space) => (
              <SpaceCard key={space.id} view={spaceView(space, now)}>
                {canUpdate && <SpaceForm space={space} back={PARTNER_PAGES.open} openOnly />}
              </SpaceCard>
            ))}
          </Stack>
        )}
        <AreaLinks label={englishText("P02.linksAria")} links={disruptionLinks()} />
      </Stack>
    </Screen>
  );
});
