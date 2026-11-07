// The seed of the partner space's dummy data (data/partners/seed.json, the product owner's decision of 2026-11-07), run as the migration role by
// scripts/seed/partners.mjs. Idempotent (AD-25): one transaction, so a database has either the whole file or what it had before.
//
//  - Organisations and spaces are upserted by id: a space's name, place, room and hours follow the file, while its status, purpose, capacities
//    and confirmation are kept as staff left them, unless the run asks to reset them (`resetStatus`, the --reset option) or the space is new.
//    A space's seeded status is recorded as its first `space_change` row (by the seeded contact, no Hub account). Nothing is ever deleted from
//    `partner_org` or `space` (a space's changes and the audit name them).
//  - Every coordination record (the shared spaces and what is in them, commitments, supplies, playbooks, teams, exercises, indicators, look back)
//    is the file's alone, as the app never writes them in this release: they are replaced as a whole.
//
// Times in the file are minutes before `now`, so whatever day the seed runs the open disruption reads as a few hours old.
import { sql } from "drizzle-orm";
import type { Db } from "@/platform/db";
import {
  lookBackAction,
  lookBackRecord,
  partnerCommitment,
  partnerDecision,
  partnerExercise,
  partnerHandover,
  partnerIndicator,
  partnerOrg,
  partnerStatement,
  partnerSupply,
  partnerTeam,
  playbook,
  sharedSpace,
  space,
  spaceChange,
} from "../adapters/schema";
import type { PartnerSeed } from "../domain/seedData";

export interface PartnerSeedOptions {
  now?: Date;
  /** Put every space back to the status the file gives it (the --reset option). */
  resetStatus?: boolean;
}

export interface PartnerSeedResult {
  orgs: number;
  spaces: { added: number; kept: number; reset: number };
  records: Record<string, number>;
}

export async function seedPartners(db: Db, data: PartnerSeed, options: PartnerSeedOptions = {}): Promise<PartnerSeedResult> {
  const now = options.now ?? new Date();
  const ago = (mins: number) => new Date(now.getTime() - mins * 60_000);
  const agoOrNull = (mins: number | null | undefined) => (mins === null || mins === undefined ? null : ago(mins));

  return db.transaction(async (tx) => {
    for (const [order, org] of data.orgs.entries()) {
      const row = {
        id: org.id,
        name: org.name,
        shortName: org.shortName,
        kind: org.kind,
        sortOrder: order,
        contactRole: org.contactRole,
        contactPhone: org.contactPhone,
        contactEmail: org.contactEmail,
        capacity: org.capacity,
        capacitySetAt: org.capacity === null ? null : ago(org.capacityMinsAgo ?? 0),
      };
      await tx.insert(partnerOrg).values(row).onConflictDoUpdate({ target: partnerOrg.id, set: row });
    }

    const existing = new Set((await tx.select({ id: space.id }).from(space)).map((row) => row.id));
    const counts = { added: 0, kept: 0, reset: 0 };
    for (const s of data.spaces) {
      const place = { orgId: s.org, providerId: s.providerId, name: s.name, room: s.room, street: s.street, opensAt: s.opensAt, closesAt: s.closesAt };
      const confirmedAt = agoOrNull(s.confirmedMinsAgo);
      const state = { purpose: s.purpose, status: s.status, capacityMax: s.capacityMax, capacityNow: s.capacityNow, confirmedAt, confirmedBy: s.confirmedBy, updatedBy: null, updatedAt: now };
      const fresh = !existing.has(s.id);
      await tx
        .insert(space)
        .values({ id: s.id, ...place, ...state })
        .onConflictDoUpdate({ target: space.id, set: options.resetStatus ? { ...place, ...state } : place });
      if (fresh || options.resetStatus) {
        await tx.insert(spaceChange).values({
          spaceId: s.id,
          status: s.status,
          purpose: s.purpose,
          capacityNow: s.capacityNow,
          capacityMax: s.capacityMax,
          changedBy: null,
          changedByLabel: s.confirmedBy ?? "Seeded",
          changedAt: confirmedAt ?? now,
        });
      }
      if (fresh) counts.added += 1;
      else if (options.resetStatus) counts.reset += 1;
      else counts.kept += 1;
    }

    // The coordination records are the file's alone: emptied, children first, then loaded again.
    for (const table of [partnerStatement, partnerDecision, partnerHandover, sharedSpace, partnerCommitment, partnerSupply, playbook, partnerTeam, partnerExercise, partnerIndicator, lookBackRecord, lookBackAction]) {
      await tx.delete(table);
    }
    const insert = async <T>(table: Parameters<typeof tx.insert>[0], rows: T[]) => {
      if (rows.length > 0) await tx.insert(table).values(rows as never);
      return rows.length;
    };
    const records: Record<string, number> = {};
    records.sharedSpaces = await insert(
      sharedSpace,
      data.sharedSpaces.map((s) => ({ id: s.id, hazard: s.hazard, level: s.level, location: s.location, purpose: s.purpose, openedAt: ago(s.openedMinsAgo), openedBy: s.openedBy, closedAt: agoOrNull(s.closedMinsAgo) })),
    );
    // A statement may answer one listed after it, so every statement is in before any answer is set.
    records.statements = await insert(
      partnerStatement,
      data.statements.map((s) => ({ id: s.id, sharedSpaceId: s.space, orgId: s.org, person: s.person, kind: s.kind, body: s.body, postedAt: ago(s.minsAgo), claimedBy: s.claimedBy ?? null, answers: null })),
    );
    for (const s of data.statements) if (s.answers) await tx.execute(sql`update partner_statement set answers = ${s.answers} where id = ${s.id}`);
    records.decisions = await insert(
      partnerDecision,
      data.decisions.map((d) => ({ id: d.id, sharedSpaceId: d.space, orgId: d.org, person: d.person, decidedAt: ago(d.minsAgo), body: d.body, why: d.why })),
    );
    records.handovers = await insert(
      partnerHandover,
      data.handovers.map((h) => ({ id: h.id, sharedSpaceId: h.space, orgId: h.org, fromPerson: h.from, toPerson: h.to, handedAt: ago(h.minsAgo), note: h.note, openItems: h.open })),
    );
    records.commitments = await insert(
      partnerCommitment,
      data.commitments.map((c) => ({ id: c.id, orgId: c.org, hazard: c.hazard, mode: c.mode, body: c.body, role: c.role, agreement: c.agreement, reviewDue: c.reviewDue, forDisruption: c.forDisruption })),
    );
    records.supplies = await insert(
      partnerSupply,
      data.supplies.map((s) => ({ id: s.id, orgId: s.org, item: s.item, qty: s.qty, qtyNum: s.qtyNum, unit: s.unit, location: s.location, updatedAt: ago(s.minsAgo) })),
    );
    records.playbooks = await insert(playbook, data.playbooks);
    records.teams = await insert(
      partnerTeam,
      data.teams.map((t) => ({ hazard: t.hazard, level: t.level, team: t.team, channels: t.channels, triggerEvent: t.trigger })),
    );
    records.exercises = await insert(partnerExercise, data.exercises);
    records.indicators = await insert(
      partnerIndicator,
      data.indicators.map((i, order) => ({ id: i.id, sortOrder: order, realValue: i.real, exerciseValue: i.exercise, everydayValue: i.everyday })),
    );
    records.records = await insert(lookBackRecord, data.records);
    records.actions = await insert(lookBackAction, data.actions);
    return { orgs: data.orgs.length, spaces: counts, records };
  });
}
