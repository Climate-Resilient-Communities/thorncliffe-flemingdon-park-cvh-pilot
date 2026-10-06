// Composition root of the inbound texts (S07.04, AD-2, AD-9): subscriptions' router on the app's database, with places' floors (for the
// subscriber's places at YES), messaging's outbox (the welcome and the replies, and the skipping of a deleted number's waiting texts), the
// key of the once-a-day limit's hashes (the rate limiter's), PUBLIC_BASE_URL for the sign-up link and the price of a segment; and the
// webhook's signature check with the Twilio account's Auth Token, recording a refused signature in ops_event as the status callbacks do.
// Server only. Where there is no Twilio account (every environment but production) nothing can be validated and the route does nothing.
//
// S07.05: the numbered menus (replies 1, 2 and 3) on the same outbox, with places' buildings and floors. S07.06: the menus offer the one-time
// web link (at the daily menu limit, and when a menu is closed with nothing changed) and send it through the edit link's port
// (src/app/subscriptionEdit.ts). S08.05: checkins' real ports (src/app/checkins.ts): reply 3 withdraws a check-in request, menu 1's move
// withdraws it ("Changed location"), YES activates one made during sign-up, and a deletion closes the subscriber's round rows.
//
// After a message that queued a text, the dispatcher is started (after the response), so a welcome or a reply goes out within seconds.
import "server-only";
import { createDeliveryQueue, stdoutMessagingLog } from "@/modules/messaging";
import { floorsOfBuilding } from "@/modules/places";
import {
  createInboundRouter,
  createInboundWebhook,
  createMenus,
  placesForMenus,
  type InboundLog,
  type InboundRouter,
  type InboundWebhook,
} from "@/modules/subscriptions";
import { getEnv, type Env } from "@/platform/config/env";
import { getDb, type Db } from "@/platform/db";
import { checkinRequests } from "./checkins";
import { kickDispatcher, opsRecorder } from "./dispatch";
import { rateLimitKey } from "./signup";
import { editLink } from "./subscriptionEdit";

/** The router's log: one JSON line per message, with its keyword, state and action only. */
const stdoutInboundLog: InboundLog = { info: (evt, fields) => stdoutMessagingLog.info(evt, fields) };

export interface InboundParts {
  env?: Pick<Env, "twilio" | "publicBaseUrl" | "smsPricePerSegmentCents">;
  db?: Db;
  router?: InboundRouter;
}

/** The router on the real database (S07.04), with the menus (S07.05). */
export function inboundRouter(parts: Pick<InboundParts, "env" | "db"> = {}): InboundRouter {
  const env = parts.env ?? getEnv();
  const db = parts.db ?? getDb();
  const pricePerSegmentCents = () => env.smsPricePerSegmentCents;
  return createInboundRouter({
    db,
    places: { floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((floor) => floor.id) ?? null },
    // The queue checks a given send_by (signup_info's inbound_reply expiry) against the database's clock of the row that set it.
    enqueue: (tx, input, now) => createDeliveryQueue(now ? { now: () => now } : {}).enqueueTransactional(tx, input),
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
    // S08.05: checkins' ports (the deletion's, YES's activation, and the menus' withdrawal and move).
    checkins: checkinRequests(),
    checkinActivation: checkinRequests(),
    menus: createMenus({
      enqueue: (tx, input) => createDeliveryQueue().enqueueTransactional(tx, input),
      pricePerSegmentCents,
      places: placesForMenus,
      checkins: checkinRequests(),
      editLink: editLink({ env, db }).port,
    }),
    numberKey: rateLimitKey,
    publicBaseUrl: () => env.publicBaseUrl,
    pricePerSegmentCents,
    log: stdoutInboundLog,
  });
}

/** The webhook on the real environment (every part can be replaced in a test). */
export function appInboundWebhook(parts: InboundParts = {}): InboundWebhook {
  const env = parts.env ?? getEnv();
  const authToken = env.twilio?.authToken;
  if (!authToken) return { handle: async () => ({ kind: "not_configured" }) };
  const db = parts.db ?? getDb();
  return createInboundWebhook({
    authToken,
    publicBaseUrl: env.publicBaseUrl,
    router: parts.router ?? inboundRouter({ env, db }),
    recordSignatureFailure: (reason) => opsRecorder.record(db, { kind: "webhook.signature_invalid", detail: { route: "twilio_inbound", reason } }),
  });
}

/** Starts the dispatcher after the response (it never throws). */
export function startSending(): void {
  kickDispatcher();
}
