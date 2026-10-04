// What an ambassador's post screen needs (A-02, S08.02), read for one request: the buildings the person is assigned to now, each with every floor (an
// Ambassador posts for any floor of an assigned building), and, for an update to an open alert (`?alert=`), that thread as it stands: its covering text, its
// types and whether it is a drill. The ids the post takes are made here, once per drawn page. Server only.
import { BUILDING_TYPES } from "@/contracts/alertContent";
import { AudienceSchema } from "@/contracts/audience";
import { audienceCoversAssigned } from "@/modules/alerting";
import { uuidv7 } from "@/platform/ids";
import { alerting } from "../../alerts";
import { assignments } from "../../assignments";
import { buildings } from "../../places";
import type { StaffSession } from "../../session";
import type { PostBuilding, PostData } from "./view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why the screen cannot be drawn: the person is assigned to no building now, or the alert named is not one they can post an update to. */
export type PostLoad = { ok: true; data: PostData } | { ok: false; reason: "not_assigned" | "no_thread" };

/**
 * The screen's data for the person, from their assignments as they are now. An alert named by `?alert=` must be open, have something residents (or, for a
 * drill, the roster) read, be about a building the person is assigned to, and be of the types an Ambassador posts (an alert of a neighbourhood-wide type is
 * the Hub's to update); the buildings offered are then those of the person's that it is about.
 */
export async function loadPost(session: Pick<StaffSession, "staffId">, alertParam: string | undefined, now: Date = new Date()): Promise<PostLoad> {
  const current = await assignments().assignmentsOf(session.staffId);
  const plans = await buildings().listFloorPlans();
  const mine: PostBuilding[] = [];
  for (const assignment of current) {
    const plan = plans.find((candidate) => candidate.rsn === assignment.rsn);
    if (plan) mine.push({ rsn: plan.rsn, address: plan.address, floors: plan.floors.map((floor) => ({ id: floor.id, label: floor.label })) });
  }
  if (mine.length === 0) return { ok: false, reason: "not_assigned" };
  const ids = { alertId: uuidv7(now.getTime()), entryId: uuidv7(now.getTime()) };
  if (alertParam === undefined || alertParam === "") return { ok: true, data: { buildings: mine, thread: null, ids } };

  const summary = UUID.test(alertParam) ? await alerting().threadSummary(alertParam) : null;
  const covering = summary?.covering ?? null;
  if (summary === null || summary.thread.status !== "open" || covering === null) return { ok: false, reason: "no_thread" };
  if (!covering.types.every((type) => (BUILDING_TYPES as readonly string[]).includes(type))) return { ok: false, reason: "no_thread" };
  const audience = AudienceSchema.safeParse(covering.audience);
  const neighbourhoodOf = new Map(plans.map((plan) => [plan.rsn, plan.neighbourhoodId]));
  if (!audience.success) return { ok: false, reason: "no_thread" };
  const about = mine.filter((building) => audienceCoversAssigned(audience.data, new Set([building.rsn]), neighbourhoodOf));
  if (about.length === 0) return { ok: false, reason: "no_thread" };
  return {
    ok: true,
    data: { buildings: about, thread: { id: summary.thread.id, isDrill: summary.thread.isDrill, headline: covering.text, types: [...covering.types] }, ids },
  };
}
