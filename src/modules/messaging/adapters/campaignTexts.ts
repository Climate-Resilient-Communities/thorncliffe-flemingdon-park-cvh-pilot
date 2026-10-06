import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";
import { delivery } from "./schema";

/**
 * What became of one campaign's texts (S09.07: the end-of-pilot campaign and its rehearsal on the drill roster), for the Hub's End of the pilot page: waiting
 * (`queued`, or claimed and not yet handed to the provider), handed to the provider (every text that was, whatever happened next), delivered, not delivered
 * (`undelivered` or `failed`), and `unknown`. Counts only.
 */
export interface CampaignTextCounts {
  waiting: number;
  handedOff: number;
  delivered: number;
  notDelivered: number;
  unknown: number;
}

export async function campaignTextCounts(executor: DbExecutor, campaignId: string): Promise<CampaignTextCounts> {
  const [row] = await executor
    .select({
      waiting: sql<number>`count(*) filter (where ${delivery.state} = 'queued' or (${delivery.state} = 'claimed' and ${delivery.handedOffAt} is null))::int`,
      handedOff: sql<number>`count(*) filter (where ${delivery.handedOffAt} is not null)::int`,
      delivered: sql<number>`count(*) filter (where ${delivery.state} = 'delivered')::int`,
      notDelivered: sql<number>`count(*) filter (where ${delivery.state} in ('undelivered', 'failed'))::int`,
      unknown: sql<number>`count(*) filter (where ${delivery.state} = 'unknown')::int`,
    })
    .from(delivery)
    .where(eq(delivery.campaignId, campaignId));
  return row ?? { waiting: 0, handedOff: 0, delivered: 0, notDelivered: 0, unknown: 0 };
}
