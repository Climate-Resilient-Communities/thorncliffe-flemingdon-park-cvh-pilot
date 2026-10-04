// A drill's results (S06.05, FR-M4): per roster member and language, how many of the drill's texts were handed to the provider, delivered, undelivered,
// failed or `unknown` (and how many still wait or were never sent). Read from `drill_delivery_result`, a view over the drill threads only, so a drill's
// counts are kept apart from every count of a real alert; nothing here reads a real alert's rows. Counts, ids and languages only: no number, no body.
// The members are named by id; the composition root (src/app/drills.ts) gives each the label the Hub calls them, which messaging does not hold.
import { eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../../platform/db";
import { drillDeliveryResult } from "../adapters/drillView";

export interface DrillResultRow {
  /** The thread entry (alert, update, correction, final) these texts belong to. */
  entryId: string;
  /** The roster member (the id of their `drill_roster` row); null once they were removed from the roster. */
  recipientId: string | null;
  lang: string;
  /** Queued, or claimed and not yet handed to the provider. */
  waiting: number;
  /** Handed to the provider, whatever became of the text since (delivered, undelivered, failed after hand-off, unknown and in flight included). */
  handedOff: number;
  delivered: number;
  undelivered: number;
  failed: number;
  unknown: number;
  /** Cancelled or skipped: the text never went to the provider (a removed member, a correction that replaced it, a log-mode environment). */
  notSent: number;
}

export interface DrillResults {
  /** One row per entry of the drill thread, roster member and language, members in a fixed order, then removed members. */
  forAlert(executor: DbExecutor, alertId: string): Promise<DrillResultRow[]>;
}

export const drillResults: DrillResults = {
  async forAlert(executor, alertId) {
    const sum = (column: AnyPgColumn) => sql<number>`coalesce(sum(${column}), 0)::int`;
    const rows = await executor
      .select({
        entryId: drillDeliveryResult.entryId,
        recipientId: drillDeliveryResult.recipientId,
        lang: drillDeliveryResult.lang,
        waiting: sum(drillDeliveryResult.waiting),
        handedOff: sum(drillDeliveryResult.handedOff),
        delivered: sum(drillDeliveryResult.delivered),
        undelivered: sum(drillDeliveryResult.undelivered),
        failed: sum(drillDeliveryResult.failed),
        unknown: sum(drillDeliveryResult.unknown),
        notSent: sum(drillDeliveryResult.notSent),
      })
      .from(drillDeliveryResult)
      .where(eq(drillDeliveryResult.alertId, alertId))
      .groupBy(drillDeliveryResult.entryId, drillDeliveryResult.recipientId, drillDeliveryResult.lang)
      .orderBy(drillDeliveryResult.entryId, drillDeliveryResult.recipientId, drillDeliveryResult.lang);
    return rows;
  },
};
