// Fixtures for tests that need `delivery` rows (S06.01; E06's later stories reuse them): staff accounts, alert entries in a
// chosen status with their frozen SMS bodies, and rows moved into a chosen state only by legal transitions through the
// app's own credentials. The owner writes the parents (an entry's own trigger is switched off for the insert, as the
// lifecycle tests do, so the entry can be in any status without the translations and the approval a real one needs).
import { randomBytes, randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { DeliveryState } from "../../src/modules/messaging";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export type StaffRole = "ambassador" | "coordinator" | "director" | "admin";
export type EntryStatus = "draft" | "pending_approval" | "approved" | "discarded";

export interface FrozenBodies {
  [lang: string]: { body: string; encoding: "gsm7" | "ucs2"; segments: number };
}

export const DEFAULT_BODIES: FrozenBodies = {
  en: { body: "Power is out in Building 12. Verified by the Hub. Reply STOP", encoding: "gsm7", segments: 1 },
  ur: { body: "عمارت 12 میں بجلی بند ہے۔ Reply STOP", encoding: "ucs2", segments: 2 },
};

export interface SeededEntry {
  alertId: string;
  entryId: string;
  authorId: string;
  /** An admin account that is not an editor of the entry: the one that may approve it (and the approver of an `approved` seed). */
  approverId: string;
  bodies: FrozenBodies;
}

const NOW = new Date("2026-10-03T15:00:00Z");

export function deliveryFixtures(owner: Sql) {
  const staffIds: string[] = [];
  const alertIds: string[] = [];
  const entryIds: string[] = [];

  async function staff(role: StaffRole = "coordinator", status = "active"): Promise<{ id: string; role: StaffRole }> {
    const id = randomUUID();
    await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, status, must_change_password)
                values (${id}, ${randomUUID()}, ${`dl_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', ${role}::staff_role, ${status}::staff_status, false)`;
    staffIds.push(id);
    return { id, role };
  }

  /** An alert thread with one entry in `status`, carrying the frozen SMS bodies a submit would have stored. */
  async function entry(status: EntryStatus = "pending_approval", options: { isDrill?: boolean; bodies?: FrozenBodies; authorId?: string } = {}): Promise<SeededEntry> {
    const author = options.authorId ?? (await staff("coordinator")).id;
    const approver = (await staff("admin")).id;
    const alertId = randomUUID();
    const entryId = randomUUID();
    const bodies = options.bodies ?? DEFAULT_BODIES;
    const frozen = status !== "draft" && status !== "discarded";
    const hash = randomBytes(32).toString("hex");
    await owner.begin(async (tx) => {
      await tx`select set_config('cvh.actor_id', ${author}, true)`;
      await tx`insert into alert (id, is_drill, reported_at, created_by) values (${alertId}, ${options.isDrill ?? false}, ${new Date(Date.now() - 60_000)}, ${author})`;
      await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
      await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until,
                                        version, content_hash, sms_bodies, submitted_at, approved_by, approved_at, approved_version, approved_hash, web_published_at)
               values (${entryId}, ${alertId}, 'ack', ${status}, ${author}, ${[author]}, 'text', ${["power"]},
                       ${tx.json({ scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] })}, 'problem', ${new Date("2026-10-04T15:00:00Z")},
                       ${frozen ? 1 : 0}, ${frozen ? hash : null}, ${frozen ? tx.json(bodies as never) : null}, ${frozen ? NOW : null},
                       ${status === "approved" ? approver : null}, ${status === "approved" ? NOW : null}, ${status === "approved" ? 1 : null},
                       ${status === "approved" ? hash : null}, ${status === "approved" ? NOW : null})`;
      await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    });
    alertIds.push(alertId);
    entryIds.push(entryId);
    return { alertId, entryId, authorId: author, approverId: approver, bodies };
  }

  /**
   * The approval of a `pending_approval` entry, as the app's role does it inside the approving transaction (S04.07): the acting
   * account approves what it did not edit, and the database stamps `approved_at = now()`.
   */
  async function approve(tx: Tx, seeded: SeededEntry) {
    await tx`select set_config('cvh.actor_id', ${seeded.approverId}, true)`;
    await tx`update alert_entry set status = 'approved', approved_by = ${seeded.approverId}, approved_version = version, approved_hash = content_hash
             where id = ${seeded.entryId}`;
  }

  async function cleanup() {
    await owner`delete from delivery`;
    await owner.begin(async (tx) => {
      for (const id of entryIds) {
        await tx`delete from alert_entry_translation where entry_id = ${id}`;
        await tx`delete from alert_entry where id = ${id}`;
      }
      for (const id of alertIds) await tx`delete from alert where id = ${id}`;
      for (const id of staffIds) await tx`delete from staff_account where id = ${id}`;
    });
    staffIds.length = 0;
    alertIds.length = 0;
    entryIds.length = 0;
  }

  return { staff, entry, approve, cleanup };
}

/** A fake E.164 number the tests look for in places it must never be (obviously not a real one). */
export const FAKE_NUMBER = "+14165550123";
export const FAKE_SID = `SM${"0123456789abcdef".repeat(2)}`;

/**
 * The states a claimed row reaches only after the provider was handed the text: the provider answers (or calls back) about a
 * text it has, so the hand-off is recorded first.
 */
export const OUTCOME_AFTER_HAND_OFF: readonly DeliveryState[] = ["submitted", "unknown", "delivered", "undelivered"];

/**
 * The statement (as the app's role) that moves a row from `from` to `to` with whatever the target state needs alongside, so
 * that the transition table is the only reason it can be refused: a claim names its worker and lease, a submission, a
 * delivery and an undelivery name the provider's id, and a handed-off row that goes back to the queue was not accepted, which
 * counts an attempt.
 */
export function transitionStatement(tx: Tx, id: string, to: DeliveryState) {
  switch (to) {
    case "claimed":
      return tx`update delivery set state = 'claimed', claimed_by = 'worker-1', claim_token = ${randomUUID()} where id = ${id}`;
    case "queued":
      return tx`update delivery set state = 'queued', attempts = attempts + (handed_off_at is not null)::int where id = ${id}`;
    case "submitted":
    case "delivered":
    case "undelivered":
      return tx`update delivery set state = ${to}, provider_message_id = coalesce(provider_message_id, ${FAKE_SID}) where id = ${id}`;
    default:
      return tx`update delivery set state = ${to} where id = ${id}`;
  }
}
