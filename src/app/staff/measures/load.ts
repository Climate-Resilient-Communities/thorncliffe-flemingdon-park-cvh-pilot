// Reads the pilot measures for the Hub page (S07.10) on the app's own database connection, as the role may see them (AD-4): counts for a Coordinator, a Director
// and an Admin (`coverage.view`), and the cost of each alert only for a Director and an Admin (`spend.view`). Server only; every reading is a SQL view that holds
// counts and amounts and nothing personal.
import "server-only";
import type { StaffRole } from "@/contracts/staffRoles";
import { can } from "@/modules/identity";
import { readCorrectionReach } from "@/modules/messaging";
import { readAlertCost, readCohereShare } from "@/modules/spend";
import { readSubscriberMeasures } from "@/modules/subscriptions";
import { getDb } from "@/platform/db";
import { procedureLink } from "../procedures";
import { costView, measuresText, reachView, subscribersView, type MeasuresView } from "./view";

/** How many alerts the page lists in each of its two lists (real, and drills). */
export const MEASURES_LIST_LIMIT = 20;

export async function loadMeasures(role: StaffRole): Promise<MeasuresView> {
  const db = getDb();
  const t = measuresText;
  const subscribers = await readSubscriberMeasures(db);
  const reach = await readCorrectionReach(db, MEASURES_LIST_LIMIT);
  const cost = can(role, "spend.view") ? costView(await readAlertCost(db, MEASURES_LIST_LIMIT), await readCohereShare(db, 3), t) : null;
  return {
    title: t("title"),
    lead: t("lead"),
    privacy: t("privacy"),
    exportNote: t("exportNote"),
    procedure: procedureLink("export-measures"),
    subscribers: subscribersView(subscribers, t),
    reach: reachView(reach, t),
    cost,
  };
}
