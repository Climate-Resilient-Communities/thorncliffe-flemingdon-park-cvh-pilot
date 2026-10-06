// Composition root of the one-time web link (S07.06, AD-2): subscriptions' edit link on the app's database, with places' neighbourhoods and
// floors (share-locked as the menus read them), messaging's outbox for the link's text and a change's confirmation (and the skipping of a
// deleted number's waiting texts), PUBLIC_BASE_URL for the link and the price of a segment. Server only. The inbound router's menus send the
// link through `editLink().port` (src/app/inbound.ts); the routes under /api/subscription/ answer the page. checkins' ports are E08's: until
// then nobody has a check-in request or check-in rows.
import "server-only";
import { createDeliveryQueue } from "@/modules/messaging";
import { floorsOfBuilding, neighbourhoodIds } from "@/modules/places";
import { createEditLink, noCheckinRequestsYet, noCheckinsYet, type EditLink } from "@/modules/subscriptions";
import { getEnv, type Env } from "@/platform/config/env";
import { getDb, type Db } from "@/platform/db";

let service: EditLink | undefined;

/** The edit link on the given database and environment (the real ones by default, made once). */
export function editLink(parts: { env?: Pick<Env, "publicBaseUrl" | "smsPricePerSegmentCents">; db?: Db } = {}): EditLink {
  if (service && !parts.env && !parts.db) return service;
  const env = parts.env ?? getEnv();
  const queue = createDeliveryQueue();
  const made = createEditLink({
    db: parts.db ?? getDb(),
    enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    places: {
      neighbourhoodIds: (executor) => neighbourhoodIds(executor),
      floorIdsOf: async (tx, rsn, options) => (await floorsOfBuilding(tx, rsn, options))?.map((floor) => floor.id) ?? null,
    },
    // E08 implements checkins' locationChanging and deleteForSubscriber.
    checkins: { ...noCheckinRequestsYet, ...noCheckinsYet },
    publicBaseUrl: () => env.publicBaseUrl,
    pricePerSegmentCents: () => env.smsPricePerSegmentCents,
  });
  if (!parts.env && !parts.db) service = made;
  return made;
}
