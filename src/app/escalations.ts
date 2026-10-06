// Composition root of the escalations (S08.08, AD-2, AD-12): checkins' text to the on-duty Admin (the marks' `EscalationFollowUp` seam, wired in
// src/app/staff/ambassador/round/load.ts), with ops' roster (whom it goes to: the on-duty entry while identity says its account is an active Admin with an
// authenticator, else every on-call number), places' words for the building and floor, messaging's renderer and outbox, PUBLIC_BASE_URL for the staff link
// and the price of a segment; and checkins' handling, on the app's database connection. Server only.
import "server-only";
import { createEscalationHandling, createEscalationTexts, type EscalationFollowUp, type EscalationHandling, type EscalationPlace } from "@/modules/checkins";
import { isOnDutyAdmin } from "@/modules/identity";
import { createDeliveryQueue, renderEscalationText } from "@/modules/messaging";
import { escalationRecipients, onDutyStateOf, type OnDutyState } from "@/modules/ops";
import { addressesOfBuildings, floorsOfBuilding } from "@/modules/places";
import { getEnv, type Env } from "@/platform/config/env";
import { getDb, type Db, type DbExecutor } from "@/platform/db";
import { ESCALATION_PAGE } from "./staff/rounds/view";

/** The staff link to an escalation's page: what the on-duty Admin opens from the text. */
export const escalationLink = (publicBaseUrl: string, escalationId: string) => `${publicBaseUrl.replace(/\/+$/, "")}${ESCALATION_PAGE}?id=${escalationId}`;

/** The building's address and the floor's label as the text names them (the register's number, and a plain word, when they are gone). */
export async function escalationPlace(executor: DbExecutor, rsn: string, floorId: string): Promise<EscalationPlace> {
  const building = (await addressesOfBuildings(executor, [rsn])).get(rsn) ?? rsn;
  const floor = (await floorsOfBuilding(executor, rsn))?.find((one) => one.id === floorId)?.label ?? "?";
  return { building, floor };
}

/** The text that follows an escalation, on the given environment (the real one by default). */
export function escalationTexts(env: Pick<Env, "publicBaseUrl" | "smsPricePerSegmentCents"> = getEnv()): EscalationFollowUp {
  const queue = createDeliveryQueue();
  return createEscalationTexts({
    recipients: (tx) => escalationRecipients(tx, isOnDutyAdmin),
    place: escalationPlace,
    render: (input) => renderEscalationText(input),
    link: (id) => escalationLink(env.publicBaseUrl, id),
    enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
    pricePerSegmentCents: () => env.smsPricePerSegmentCents,
  });
}

/** "Mark handled", on the given database (the app's by default). */
export function escalationHandling(db: Db = getDb()): EscalationHandling {
  return createEscalationHandling({ db });
}

/** Whether an escalation has an on-duty Admin to go to now (the approval view's warning and the on-call page's line). */
export function onDutyState(executor: DbExecutor = getDb()): Promise<OnDutyState> {
  return onDutyStateOf(executor, isOnDutyAdmin);
}
