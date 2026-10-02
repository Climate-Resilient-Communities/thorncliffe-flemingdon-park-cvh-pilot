import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { staffPage } from "../guard";
import { buildings } from "../places";
import { addFloorAction, confirmBuildingAction, removeFloorAction, renameFloorAction, setContactAction } from "./actions";
import { BuildingsBody } from "./BuildingsBody";
import { buildingView, listView, missingView, savedNotice, type SavedQuery } from "./view";

export const metadata: Metadata = { title: englishText("staff.buildings.title") };

const actions = { add: addFloorAction, rename: renameFloorAction, remove: removeFloorAction, confirm: confirmBuildingAction, contact: setContactAction };

type Query = SavedQuery & { building?: string | string[] };

/**
 * "Buildings and floors" (S01.13): the policy action `buildings.manage`, Admins only (S01.12). The
 * list of the pilot buildings, and, with `?building=<rsn>`, one building's floors, facts and
 * confirmation. Staff at the Hub only (the guard sends everyone else to sign-in or their setup
 * gate); another role sees "Only an Admin can change buildings and floors." and each action of the
 * page refuses it on its own. Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/buildings",
    access: "hub",
    action: "buildings.manage",
    refused: () => (
      <Screen surface="staff">
        <p role="alert">{englishText("staff.buildings.errors.forbidden")}</p>
      </Screen>
    ),
  },
  async (_session, props: { searchParams?: Promise<Query> }) => {
    const query = (await props.searchParams) ?? {};
    const rsn = Array.isArray(query.building) ? query.building[0] : query.building;
    const notice = savedNotice(query);
    const service = buildings();
    const detail = rsn === undefined ? null : await service.getBuilding(rsn);
    const screen = rsn === undefined ? listView(await service.listBuildings(), notice) : detail ? buildingView(detail, notice) : missingView();
    return (
      <Screen surface="staff">
        <BuildingsBody screen={screen} actions={actions} />
      </Screen>
    );
  },
);
