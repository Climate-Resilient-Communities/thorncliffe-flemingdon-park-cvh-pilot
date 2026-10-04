// The drill view's counts (S06.05, db/migrations/20261004110000_drill_roster.sql): for each drill thread, entry, roster member (the id of their
// `drill_roster` row, null once the member was deleted) and language, how many texts are waiting, were handed to the provider, were delivered,
// undelivered, failed or `unknown`, or were never sent. A view over the drill threads only, so a drill's counts are kept apart from every count of a
// real alert (FR-M4). It is declared `existing()`: Drizzle never creates it, the migration does, and the drift test reads only `schema.ts`. It holds
// no phone number and no body.
import { integer, pgView, text, uuid } from "drizzle-orm/pg-core";

export const drillDeliveryResult = pgView("drill_delivery_result", {
  alertId: uuid("alert_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  recipientId: uuid("recipient_id"),
  lang: text().notNull(),
  waiting: integer().notNull(),
  handedOff: integer("handed_off").notNull(),
  delivered: integer().notNull(),
  undelivered: integer().notNull(),
  failed: integer().notNull(),
  unknown: integer().notNull(),
  notSent: integer("not_sent").notNull(),
}).existing();
