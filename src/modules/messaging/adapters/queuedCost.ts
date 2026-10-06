import { and, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";
import { delivery } from "./schema";

/**
 * The estimated cost, in whole cents CAD, of the texts that are waiting to be sent: `queued`, or `claimed` and not yet settled. A text's estimate
 * is written to the spend record only when the provider accepts it or its outcome becomes `unknown` (S06.08), so none of these is in the month's
 * spending yet; the spend cap (S07.08) adds them to the month so that approvals made while a pause holds texts, or while the sender is behind, are
 * judged against what they will cost. `exceptEntryId` leaves out one alert entry's own texts (the approval being judged counts them as its estimate), and
 * `exceptCampaignId` one campaign's (S09.07: the start judges the cap after queuing its texts in the same transaction, and counts them as its estimate).
 */
export async function queuedCostCents(executor: DbExecutor, options: { exceptEntryId?: string; exceptCampaignId?: string } = {}): Promise<number> {
  const [row] = await executor
    .select({ cents: sql<string>`coalesce(sum(${delivery.costEstimateCents}), 0)` })
    .from(delivery)
    .where(
      and(
        inArray(delivery.state, ["queued", "claimed"]),
        options.exceptEntryId === undefined ? undefined : or(isNull(delivery.entryId), ne(delivery.entryId, options.exceptEntryId)),
        options.exceptCampaignId === undefined ? undefined : or(isNull(delivery.campaignId), ne(delivery.campaignId, options.exceptCampaignId)),
      ),
    );
  return Number(row?.cents ?? 0);
}
