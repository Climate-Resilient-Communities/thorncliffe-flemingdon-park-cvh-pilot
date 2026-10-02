// The provider catalogue seed (S02.04, AD-11, AD-25): idempotent upserts of what
// domain/providerCatalogue.ts allows, in one transaction with the `seed.run` audit event.
//
//  - provider, provider_location, category and provider_category are upserted keyed by the
//    provider's `id` (the category's label id); a provider in several categories is stored once;
//  - a row is written only when it differs from the file, so running the seed twice changes nothing;
//  - a provider that is no longer in providers.json is unpublished and flagged "not in catalogue"
//    (`in_catalogue = false`), never deleted, and its last-confirmed date is kept;
//  - `published` and `last_confirmed` of a provider still in the file are never touched: the Hub's
//    Admins own them (application/providers.ts);
//  - when the file fails its schema, nothing is written and the refusal is audited.
import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { record, recordRefusal } from "@/modules/audit";
import type { Db } from "@/platform/db";
import { catalogueTextId, sourceHash } from "../adapters/hash";
import { category, provider, providerCategory, providerLocation } from "../adapters/schema";
import {
  formatProviderFailures,
  formatProviderReport,
  planProviderCatalogue,
  type ProviderCatalogueInput,
  type ProviderSeedPlan,
  type ProviderSeedReport,
} from "../domain/providerCatalogue";

const SEED_CODE = "provider_catalogue";

/** What the seed would load from the files (the dry run); nothing is written. */
export function planProviders(input: ProviderCatalogueInput): ProviderSeedPlan {
  return planProviderCatalogue(input, { hash: sourceHash, textId: catalogueTextId });
}

/** The file failed its schema: nothing was written. Every failing entry is in `failures`. */
export class ProviderSeedRefusedError extends Error {
  constructor(readonly failures: string[]) {
    super(formatProviderFailures(failures).join("\n"));
    this.name = "ProviderSeedRefusedError";
  }
}

export interface ProviderSeedResult {
  report: ProviderSeedReport;
  /** Rows inserted or changed by this run; all 0 when the database already matches the files. */
  changed: { providers: number; locations: number; categories: number; categoryLinks: number };
  /** Providers that left the catalogue in this run: unpublished (if they were published) and flagged. */
  removed: { flagged: number; unpublished: number };
}

const CHUNK = 200;

/** Loads the provider catalogue. Throws ProviderSeedRefusedError, before any write, when the file fails its schema. */
export async function seedProviders(db: Db, input: ProviderCatalogueInput): Promise<ProviderSeedResult> {
  const plan = planProviders(input);
  if (plan.failures.length > 0) {
    await recordRefusal(db, {
      action: "seed.run",
      actorStaffId: null,
      subjectType: "provider_catalogue",
      subjectId: null,
      meta: { seed: SEED_CODE, failures: plan.failures.length },
    });
    throw new ProviderSeedRefusedError(plan.failures);
  }

  const changed = { providers: 0, locations: 0, categories: 0, categoryLinks: 0 };
  const removed = { flagged: 0, unpublished: 0 };
  let retired = 0;
  let linksAdded = 0;
  let linksRemoved = 0;
  const providerIds = plan.providers.map((p) => p.id);
  const categoryIds = plan.categories.map((c) => c.id);

  await db.transaction(async (tx) => {
    // Categories first: the providers link to them.
    for (const c of plan.categories) {
      const rows = await tx
        .insert(category)
        .values({ id: c.id, name: c.name, sortOrder: c.sortOrder, labels: c.labels, translations: c.translations, inCatalogue: true })
        .onConflictDoUpdate({
          target: category.id,
          set: {
            name: sql`excluded.name`,
            sortOrder: sql`excluded.sort_order`,
            labels: sql`excluded.labels`,
            translations: sql`excluded.translations`,
            inCatalogue: sql`excluded.in_catalogue`,
          },
          setWhere: sql`(${category.name}, ${category.sortOrder}, ${category.labels}, ${category.translations}, ${category.inCatalogue})
            is distinct from (excluded.name, excluded.sort_order, excluded.labels, excluded.translations, excluded.in_catalogue)`,
        })
        .returning({ id: category.id });
      changed.categories += rows.length;
    }
    // A category that left labels is kept (a removed provider may still link to it), flagged.
    const retiredRows = await tx
      .update(category)
      .set({ inCatalogue: false })
      .where(and(eq(category.inCatalogue, true), notInArray(category.id, categoryIds)))
      .returning({ id: category.id });
    retired = retiredRows.length;
    changed.categories += retired;

    // Providers that left the file: unpublished and flagged, never deleted; last_confirmed stays as it is.
    const gone = await tx
      .select({ id: provider.id, published: provider.published, inCatalogue: provider.inCatalogue })
      .from(provider)
      .where(and(notInArray(provider.id, providerIds), or(eq(provider.inCatalogue, true), eq(provider.published, true))))
      .for("update");
    if (gone.length > 0) {
      await tx
        .update(provider)
        .set({ inCatalogue: false, published: false, publishedAt: null, updatedAt: sql`now()` })
        .where(inArray(provider.id, gone.map((row) => row.id)));
      removed.flagged = gone.filter((row) => row.inCatalogue).length;
      removed.unpublished = gone.filter((row) => row.published).length;
    }

    for (const p of plan.providers) {
      const rows = await tx
        .insert(provider)
        .values({
          id: p.id,
          name: p.name,
          subcategories: p.subcategories,
          contact: p.contact,
          texts: p.texts,
          translations: p.translations,
          sourceNotes: p.sourceNotes,
          inCatalogue: true,
        })
        .onConflictDoUpdate({
          target: provider.id,
          // Not published, published_at or last_confirmed: those belong to the Admins.
          set: {
            name: sql`excluded.name`,
            subcategories: sql`excluded.subcategories`,
            contact: sql`excluded.contact`,
            texts: sql`excluded.texts`,
            translations: sql`excluded.translations`,
            sourceNotes: sql`excluded.source_notes`,
            inCatalogue: sql`excluded.in_catalogue`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`(${provider.name}, ${provider.subcategories}, ${provider.contact}, ${provider.texts}, ${provider.translations}, ${provider.sourceNotes}, ${provider.inCatalogue})
            is distinct from (excluded.name, excluded.subcategories, excluded.contact, excluded.texts, excluded.translations, excluded.source_notes, excluded.in_catalogue)`,
        })
        .returning({ id: provider.id });
      changed.providers += rows.length;

      const location = await tx
        .insert(providerLocation)
        .values({ providerId: p.id, seq: 0, ...p.location })
        .onConflictDoUpdate({
          target: [providerLocation.providerId, providerLocation.seq],
          set: {
            street: sql`excluded.street`,
            city: sql`excluded.city`,
            postal: sql`excluded.postal`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
          },
          setWhere: sql`(${providerLocation.street}, ${providerLocation.city}, ${providerLocation.postal}, ${providerLocation.lat}, ${providerLocation.lng})
            is distinct from (excluded.street, excluded.city, excluded.postal, excluded.lat, excluded.lng)`,
        })
        .returning({ id: providerLocation.providerId });
      changed.locations += location.length;
    }
    const extraLocations = await tx
      .delete(providerLocation)
      .where(and(inArray(providerLocation.providerId, providerIds), sql`${providerLocation.seq} <> 0`))
      .returning({ id: providerLocation.providerId });
    changed.locations += extraLocations.length;

    // provider_category: the file's links for the providers in it; a removed provider keeps its links.
    const existing = await tx
      .select({ providerId: providerCategory.providerId, categoryId: providerCategory.categoryId })
      .from(providerCategory)
      .where(inArray(providerCategory.providerId, providerIds));
    const have = new Set(existing.map((link) => `${link.providerId}:${link.categoryId}`));
    const want = plan.providers.flatMap((p) => p.categoryIds.map((categoryId) => ({ providerId: p.id, categoryId })));
    const wanted = new Set(want.map((link) => `${link.providerId}:${link.categoryId}`));
    const stale = existing.filter((link) => !wanted.has(`${link.providerId}:${link.categoryId}`));
    const missing = want.filter((link) => !have.has(`${link.providerId}:${link.categoryId}`));
    for (let i = 0; i < stale.length; i += CHUNK) {
      await tx
        .delete(providerCategory)
        .where(or(...stale.slice(i, i + CHUNK).map((link) => and(eq(providerCategory.providerId, link.providerId), eq(providerCategory.categoryId, link.categoryId)))));
    }
    for (let i = 0; i < missing.length; i += CHUNK) {
      await tx.insert(providerCategory).values(missing.slice(i, i + CHUNK)).onConflictDoNothing();
    }
    linksRemoved = stale.length;
    linksAdded = missing.length;
    changed.categoryLinks = linksAdded + linksRemoved;

    const { translations } = plan.report;
    const notYet = translations.unavailable.filter((u) => u.reason === "not_translated").reduce((sum, u) => sum + u.count, 0);
    const notLoaded = translations.unavailable.reduce((sum, u) => sum + u.count, 0) - notYet;
    // seed.run allows only a seed code, counts, warnings and failures (src/modules/audit/domain/actions.ts):
    // warnings are translations not loaded although they exist (machine, stale, ...).
    await record(tx, {
      action: "seed.run",
      actorStaffId: null,
      subjectType: "provider_catalogue",
      subjectId: null,
      meta: {
        seed: SEED_CODE,
        counts: {
          providers_loaded: plan.providers.length,
          providers_changed: changed.providers,
          providers_not_in_catalogue: removed.flagged,
          providers_unpublished: removed.unpublished,
          locations_changed: changed.locations,
          categories_loaded: plan.categories.length,
          categories_changed: changed.categories,
          categories_retired: retired,
          category_links_added: linksAdded,
          category_links_removed: linksRemoved,
          translations_loaded: translations.loaded,
          translations_not_yet: notYet,
        },
        warnings: notLoaded,
        failures: 0,
      },
    });
  });

  return { report: plan.report, changed, removed };
}

export { formatProviderFailures, formatProviderReport };
