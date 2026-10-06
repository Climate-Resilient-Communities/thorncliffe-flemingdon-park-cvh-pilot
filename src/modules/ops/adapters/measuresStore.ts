import { sql } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";
import type { ApprovalTimingRow, CheckinRow, DeliveryTimingRow, DrillRow, LanguageTimingRow, SearchRow, TranslationRow, UsageRow } from "../domain/measureLines";

// Reads the SQL views of the pilot measures (S09.05, db/migrations/20261006200000_pilot_measures.sql) and the earlier one they sit beside (S04.07's
// `alert_approval_timing`). Every view holds counts, times, codes, places and the ids of alerts and entries: nothing personal is selected, because nothing
// personal is there. Read-only; the caller gives one read-only snapshot.

const date = (value: string | Date) => new Date(value);
const num = (value: string | number | null) => (value === null ? null : Number(value));
const day = (value: string | Date | null) => (value === null ? null : String(value).slice(0, 10));
const uuidList = (ids: readonly string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

export const measuresStore = {
  /** Every week's usage counts (installs, directory, listing, map, guide and numbers views). */
  async usage(executor: DbExecutor): Promise<UsageRow[]> {
    const rows = await executor.execute<{ week_start: string; evt: string; lang: string; nbhd: string; n: string | number }>(sql`
      select week_start::text as week_start, evt, lang, nbhd, n from usage_week_count`);
    return rows.map((row) => ({ weekStart: String(row.week_start).slice(0, 10), evt: row.evt, lang: row.lang, nbhd: row.nbhd, n: Number(row.n) }));
  },

  /** The search measures of one week and of the pilot to date, by page language and in all. */
  async search(executor: DbExecutor, week: string): Promise<SearchRow[]> {
    const rows = await executor.execute<{ week_start: string | null; lang: string | null; searches: number; no_clear_match: number; failed: number; median_ms: number | null }>(sql`
      select week_start::text as week_start, lang, searches, no_clear_match, failed, median_ms
      from search_measure
      where week_start is null or week_start = ${week}::date`);
    return rows.map((row) => ({
      weekStart: day(row.week_start),
      lang: row.lang,
      searches: Number(row.searches),
      noClearMatch: Number(row.no_clear_match),
      failed: Number(row.failed),
      medianMs: num(row.median_ms),
    }));
  },

  /** S04.07's approval timings: one per approved entry. */
  async approvals(executor: DbExecutor): Promise<ApprovalTimingRow[]> {
    const rows = await executor.execute<{
      entry_id: string;
      alert_id: string;
      kind: string;
      is_drill: boolean;
      approved_at: string | Date;
      first_save_to_approval_ms: string | number;
      reported_to_first_ack_ms: string | number | null;
    }>(sql`
      select entry_id, alert_id, kind, is_drill, approved_at, first_save_to_approval_ms, reported_to_first_ack_ms from alert_approval_timing`);
    return rows.map((row) => ({
      entryId: row.entry_id,
      alertId: row.alert_id,
      kind: row.kind,
      isDrill: row.is_drill,
      approvedAt: date(row.approved_at),
      firstSaveToApprovalMs: Number(row.first_save_to_approval_ms),
      reportedToFirstAckMs: num(row.reported_to_first_ack_ms),
    }));
  },

  /** Each approved entry's texts, every language together (a resent text counted once, with its original). */
  async deliveries(executor: DbExecutor): Promise<DeliveryTimingRow[]> {
    const rows = await executor.execute<{
      entry_id: string;
      alert_id: string;
      is_drill: boolean;
      handed_off: number;
      delivered: number;
      first_hand_off_seconds: string | number | null;
      ninety_percent_seconds: string | number | null;
    }>(sql`
      select entry_id, alert_id, is_drill, handed_off, delivered, first_hand_off_seconds, ninety_percent_seconds from alert_delivery_timing where lang is null`);
    return rows.map((row) => ({
      entryId: row.entry_id,
      alertId: row.alert_id,
      isDrill: row.is_drill,
      handedOff: Number(row.handed_off),
      delivered: Number(row.delivered),
      firstHandOffSeconds: num(row.first_hand_off_seconds),
      ninetyPercentSeconds: num(row.ninety_percent_seconds),
    }));
  },

  /** The same per entry and language. */
  async languageTimings(executor: DbExecutor): Promise<LanguageTimingRow[]> {
    const rows = await executor.execute<{ entry_id: string; lang: string; is_drill: boolean; handed_off: number; ninety_percent_seconds: string | number | null }>(sql`
      select entry_id, lang, is_drill, handed_off, ninety_percent_seconds from alert_delivery_timing where lang is not null`);
    return rows.map((row) => ({ entryId: row.entry_id, lang: row.lang, isDrill: row.is_drill, handedOff: Number(row.handed_off), ninetyPercentSeconds: num(row.ninety_percent_seconds) }));
  },

  /** The round tally of every closed, non-drill thread, by building and floor. */
  async checkins(executor: DbExecutor): Promise<CheckinRow[]> {
    const rows = await executor.execute<{
      alert_id: string;
      closed_at: string | Date;
      rsn: string;
      nbhd: string;
      address: string;
      floor_id: string;
      floor_label: string | null;
      floor_order: number | null;
      status: string;
      n: number;
    }>(sql`
      select alert_id, closed_at, rsn, nbhd, address, floor_id, floor_label, floor_order, status, n from checkin_round_count`);
    return rows.map((row) => ({
      alertId: row.alert_id,
      closedAt: date(row.closed_at),
      rsn: row.rsn,
      nbhd: row.nbhd,
      address: row.address,
      floorId: row.floor_id,
      floorLabel: row.floor_label,
      floorOrder: row.floor_order,
      status: row.status,
      n: Number(row.n),
    }));
  },

  /** Whether each approved entry's language fell back to English. */
  async translations(executor: DbExecutor): Promise<TranslationRow[]> {
    const rows = await executor.execute<{ entry_id: string; alert_id: string; is_drill: boolean; lang: string; fell_back: boolean }>(sql`
      select entry_id, alert_id, is_drill, lang, fell_back from alert_translation_outcome`);
    return rows.map((row) => ({ entryId: row.entry_id, alertId: row.alert_id, isDrill: row.is_drill, lang: row.lang, fellBack: row.fell_back }));
  },

  /** Each drill thread with an approved entry, and its texts to the drill roster. */
  async drills(executor: DbExecutor): Promise<DrillRow[]> {
    const rows = await executor.execute<{
      alert_id: string;
      first_approved_at: string | Date;
      entries_approved: number;
      handed_off: number;
      delivered: number;
      not_delivered: number;
      unknown: number;
      not_sent: number;
    }>(sql`
      select alert_id, first_approved_at, entries_approved, handed_off, delivered, not_delivered, unknown, not_sent from drill_measure`);
    return rows.map((row) => ({
      alertId: row.alert_id,
      firstApprovedAt: date(row.first_approved_at),
      entriesApproved: Number(row.entries_approved),
      handedOff: Number(row.handed_off),
      delivered: Number(row.delivered),
      notDelivered: Number(row.not_delivered),
      unknown: Number(row.unknown),
      notSent: Number(row.not_sent),
    }));
  },

  /**
   * The alerts (threads) of the approved entries named, and every approved entry of those alerts: what the measures leave out for a rehearsal. An id that
   * names no approved entry is not found (S04.07's view lists every approved entry, and an entry sent for a rehearsal was approved).
   */
  async threadsOf(executor: DbExecutor, entryIds: readonly string[]): Promise<{ alertIds: Set<string>; entryIds: Set<string>; found: Set<string> }> {
    if (entryIds.length === 0) return { alertIds: new Set(), entryIds: new Set(), found: new Set() };
    const named = await executor.execute<{ entry_id: string; alert_id: string }>(sql`
      select entry_id, alert_id from alert_approval_timing where entry_id in (${uuidList(entryIds)})`);
    const alertIds = new Set(named.map((row) => row.alert_id));
    if (alertIds.size === 0) return { alertIds, entryIds: new Set(), found: new Set() };
    const all = await executor.execute<{ entry_id: string }>(sql`
      select entry_id from alert_approval_timing where alert_id in (${uuidList([...alertIds])})`);
    return { alertIds, entryIds: new Set(all.map((row) => row.entry_id)), found: new Set(named.map((row) => row.entry_id)) };
  },
};
