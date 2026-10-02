// What a Hub Admin does with the loaded provider catalogue (S02.04, FR-G4): publish or unpublish
// a provider and set its last-confirmed date. Nothing else about a provider changes here: the
// listing text comes only from the catalogue scripts (AD-11), and the app's database role may
// update only these columns (db/migrations/20261002200000_provider_catalogue.sql).
//
// Who may do this (Admins, at aal2) is decided by the caller's guard (src/app/staff/guard.ts,
// the policy action `provider.manage`); a use case takes the acting staff member's id for the
// audit record. Each change locks the provider's row, applies domain/providerState.ts, and writes
// the audit record in the same transaction; a refusal is audited in its own transaction after.
import { asc, eq, sql } from "drizzle-orm";
import { record, recordRefusal, type AuditMeta } from "@/modules/audit";
import type { Db } from "@/platform/db";
import { category, provider, providerCategory, providerLocation } from "../adapters/schema";
import {
  PROVIDER_ID,
} from "../domain/providerCatalogue";
import {
  decideConfirm,
  decidePublish,
  decideUnpublish,
  torontoDate,
  type ProviderDecision,
  type ProviderError,
  type ProviderState,
} from "../domain/providerState";

export interface ProviderListItem {
  id: string;
  name: string;
  /** English category names, in the catalogue's order. */
  categories: string[];
  street: string | null;
  published: boolean;
  inCatalogue: boolean;
  /** YYYY-MM-DD, or null until an Admin confirms the provider. */
  lastConfirmed: string | null;
}

export type ProviderResult = { ok: true; name: string; lastConfirmed: string | null } | { ok: false; error: ProviderError };

export interface ProviderOptions {
  /** Test seam. */
  now?: () => Date;
}

/** Every provider in the database for the Admin's list: the ones in the catalogue by id, then the ones that left it. */
export async function listProviders(db: Db): Promise<ProviderListItem[]> {
  const rows = await db
    .select({
      id: provider.id,
      name: provider.name,
      street: providerLocation.street,
      published: provider.published,
      inCatalogue: provider.inCatalogue,
      lastConfirmed: provider.lastConfirmed,
    })
    .from(provider)
    .leftJoin(providerLocation, sql`${providerLocation.providerId} = ${provider.id} and ${providerLocation.seq} = 0`)
    .orderBy(sql`${provider.inCatalogue} desc`, asc(provider.id));
  const links = await db
    .select({ providerId: providerCategory.providerId, name: category.name })
    .from(providerCategory)
    .innerJoin(category, eq(category.id, providerCategory.categoryId))
    .orderBy(asc(category.sortOrder));
  const categories = new Map<string, string[]>();
  for (const link of links) categories.set(link.providerId, [...(categories.get(link.providerId) ?? []), link.name]);
  return rows.map((row) => ({ ...row, categories: categories.get(row.id) ?? [] }));
}

const REFUSAL_REASON: Record<ProviderError, "not_found" | "validation" | "conflict"> = {
  not_found: "not_found",
  confirm_first: "validation",
  date_invalid: "validation",
  date_in_future: "validation",
  not_in_catalogue: "conflict",
  already_published: "conflict",
  not_published: "conflict",
};

/** The audit record of a change, typed per action: each action carries its own meta. */
type ProviderAudit =
  | { action: "provider.published"; meta: AuditMeta<"provider.published"> }
  | { action: "provider.unpublished"; meta: AuditMeta<"provider.unpublished"> }
  | { action: "provider.confirmed"; meta: AuditMeta<"provider.confirmed"> };

type Change = {
  decide: (state: ProviderState) => ProviderDecision;
  /** The columns to write, given the row's state; and the audit record. */
  apply: (state: ProviderState, now: Date) => { set: Partial<typeof provider.$inferInsert>; audit: ProviderAudit };
};

function recordChange(tx: Parameters<typeof record>[0], actorStaffId: string, providerId: string, audit: ProviderAudit) {
  const subject = { actorStaffId, subjectType: "provider", subjectId: providerId };
  switch (audit.action) {
    case "provider.published":
      return record(tx, { ...subject, action: audit.action, meta: audit.meta });
    case "provider.unpublished":
      return record(tx, { ...subject, action: audit.action, meta: audit.meta });
    case "provider.confirmed":
      return record(tx, { ...subject, action: audit.action, meta: audit.meta });
  }
}

async function change(
  db: Db,
  actorStaffId: string,
  providerId: string,
  action: ProviderAudit["action"],
  change: Change,
  options: ProviderOptions,
): Promise<ProviderResult> {
  const now = (options.now ?? (() => new Date()))();
  const outcome = await db.transaction(async (tx): Promise<ProviderResult> => {
    const [row] = await tx
      .select({ name: provider.name, published: provider.published, inCatalogue: provider.inCatalogue, lastConfirmed: provider.lastConfirmed })
      .from(provider)
      .where(eq(provider.id, providerId))
      .for("update");
    if (!row) return { ok: false, error: "not_found" };
    const state: ProviderState = { published: row.published, inCatalogue: row.inCatalogue, lastConfirmed: row.lastConfirmed };
    const decision = change.decide(state);
    if (!decision.ok) return decision;
    const { set, audit } = change.apply(state, now);
    await tx
      .update(provider)
      .set({ ...set, updatedAt: sql`now()` })
      .where(eq(provider.id, providerId));
    await recordChange(tx, actorStaffId, providerId, audit);
    return { ok: true, name: row.name, lastConfirmed: set.lastConfirmed === undefined ? state.lastConfirmed : set.lastConfirmed };
  });
  if (!outcome.ok) {
    await recordRefusal(db, {
      action,
      actorStaffId,
      subjectType: "provider",
      subjectId: PROVIDER_ID.test(providerId) ? providerId : null,
      meta: { reason: REFUSAL_REASON[outcome.error] },
    });
  }
  return outcome;
}

/** Publishes a provider. Refused with `confirm_first` when it has no last-confirmed date. */
export function publishProvider(db: Db, actorStaffId: string, providerId: string, options: ProviderOptions = {}): Promise<ProviderResult> {
  return change(
    db,
    actorStaffId,
    providerId,
    "provider.published",
    {
      decide: decidePublish,
      // decidePublish refused a provider with no date; the audit record requires it.
      apply: (state, now) => ({
        set: { published: true, publishedAt: now },
        audit: { action: "provider.published", meta: { last_confirmed: state.lastConfirmed ?? undefined } },
      }),
    },
    options,
  );
}

/** Takes a provider out of the directory; its last-confirmed date stays. */
export function unpublishProvider(db: Db, actorStaffId: string, providerId: string, options: ProviderOptions = {}): Promise<ProviderResult> {
  return change(
    db,
    actorStaffId,
    providerId,
    "provider.unpublished",
    {
      decide: decideUnpublish,
      apply: () => ({ set: { published: false, publishedAt: null }, audit: { action: "provider.unpublished", meta: {} } }),
    },
    options,
  );
}

/** Sets a provider's last-confirmed date: a real date, today (Toronto) or earlier. */
export function confirmProvider(db: Db, actorStaffId: string, providerId: string, date: string, options: ProviderOptions = {}): Promise<ProviderResult> {
  return change(
    db,
    actorStaffId,
    providerId,
    "provider.confirmed",
    {
      decide: (state) => decideConfirm(state, date, torontoDate((options.now ?? (() => new Date()))())),
      apply: (state) => ({
        set: { lastConfirmed: date },
        audit: { action: "provider.confirmed", meta: { confirmed_on: date, previous: state.lastConfirmed } },
      }),
    },
    options,
  );
}
