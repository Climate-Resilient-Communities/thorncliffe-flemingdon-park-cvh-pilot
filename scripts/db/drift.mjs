// Drizzle drift check (S01.03). The SQL migrations are canonical and the
// Drizzle schema is written by hand, so the two can disagree. To compare them
// on equal terms, the Drizzle schema is turned into DDL by drizzle-kit and
// applied to an empty scratch database on the same server; the migrated
// database and the scratch database are then read with the same catalog
// queries and compared: tables, columns (type, nullability, default, identity,
// generated), constraints, indexes, row level security, policies and enums.
// Constraint and index names are ignored, definitions are not.

import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import postgres from "postgres";
import { appSchemaCondition, notExtensionMember } from "./schemas.mjs";

/**
 * Reads the app schemas of a database into a comparable structure.
 *
 * @param {import("postgres").Sql} sql
 */
export async function introspect(sql) {
  const app = appSchemaCondition("n");
  const tables = await sql.unsafe(`
    select c.oid, n.nspname || '.' || c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and ${app} and ${notExtensionMember("c")}`);
  const oids = tables.map((t) => t.oid);
  const result = { tables: {}, enums: {} };
  const byOid = new Map();
  for (const t of tables) {
    const entry = { rls: t.rls, forceRls: t.force_rls, columns: {}, constraints: [], indexes: [], policies: [] };
    result.tables[t.name] = entry;
    byOid.set(t.oid, entry);
  }

  if (oids.length > 0) {
    const columns = await sql.unsafe(
      `select a.attrelid as oid, a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
              a.attnotnull as not_null, pg_get_expr(d.adbin, d.adrelid) as default_value,
              a.attidentity as identity, a.attgenerated as generated
       from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = any($1::oid[]) and a.attnum > 0 and not a.attisdropped`,
      [oids],
    );
    for (const c of columns) {
      byOid.get(c.oid).columns[c.name] = {
        type: c.type,
        notNull: c.not_null,
        default: c.default_value,
        identity: c.identity || null,
        generated: c.generated || null,
      };
    }
    const constraints = await sql.unsafe(
      `select conrelid as oid, contype as type, pg_get_constraintdef(oid) as definition
       from pg_constraint where conrelid = any($1::oid[]) and contype not in ('n', 't')`,
      [oids],
    );
    // A constraint trigger (contype 't') is a trigger, which Drizzle cannot express and this check leaves to the
    // migrations (the grants and the triggers live only there); it is not a table constraint.
    // A constraint added NOT VALID (expand-only: existing rows are not scanned) has the same shape as
    // a validated one, and Drizzle cannot say NOT VALID, so the validation state is not compared.
    for (const c of constraints) byOid.get(c.oid).constraints.push(c.definition.replace(/ NOT VALID$/, ""));
    const indexes = await sql.unsafe(
      `select i.indrelid as oid, pg_get_indexdef(i.indexrelid) as definition
       from pg_index i
       where i.indrelid = any($1::oid[])
         and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid and k.conrelid = i.indrelid)`,
      [oids],
    );
    for (const i of indexes) {
      byOid.get(i.oid).indexes.push(i.definition.replace(/ INDEX (?:"(?:[^"]|"")+"|\S+) ON /, " INDEX ON "));
    }
    const policies = await sql.unsafe(
      `select (quote_ident(p.schemaname) || '.' || quote_ident(p.tablename))::regclass::oid as oid,
              p.policyname, p.permissive, p.roles::text[] as roles, p.cmd, p.qual, p.with_check
       from pg_policies p join pg_namespace n on n.nspname = p.schemaname
       where ${app}`,
    );
    for (const p of policies) {
      byOid
        .get(p.oid)
        ?.policies.push(
          `"${p.policyname}" ${p.permissive} ${p.cmd} TO ${[...p.roles].sort().join(",")} USING (${p.qual ?? ""}) WITH CHECK (${p.with_check ?? ""})`,
        );
    }
  }
  for (const entry of byOid.values()) {
    entry.constraints.sort();
    entry.indexes.sort();
    entry.policies.sort();
  }

  const enums = await sql.unsafe(`
    select n.nspname || '.' || t.typname as name, array_agg(e.enumlabel order by e.enumsortorder)::text[] as labels
    from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_enum e on e.enumtypid = t.oid
    where ${app}
    group by 1`);
  for (const e of enums) result.enums[e.name] = [...e.labels];
  return result;
}

function diffSets(where, kind, migrated, drizzle) {
  const differences = [];
  for (const item of migrated) {
    if (!drizzle.includes(item)) differences.push(`${where}: ${kind} ${item} is in the migrations but not in the Drizzle schema`);
  }
  for (const item of drizzle) {
    if (!migrated.includes(item)) differences.push(`${where}: ${kind} ${item} is in the Drizzle schema but not in the migrations`);
  }
  return differences;
}

/**
 * @param {Awaited<ReturnType<typeof introspect>>} migrated
 * @param {Awaited<ReturnType<typeof introspect>>} drizzle
 * @returns {string[]} differences; empty when the two match
 */
export function compareSchemas(migrated, drizzle) {
  const differences = [];
  const names = [...new Set([...Object.keys(migrated.tables), ...Object.keys(drizzle.tables)])].sort();
  for (const name of names) {
    const m = migrated.tables[name];
    const d = drizzle.tables[name];
    if (!d) {
      differences.push(`table ${name} is in the migrations but not in the Drizzle schema`);
      continue;
    }
    if (!m) {
      differences.push(`table ${name} is in the Drizzle schema but not in the migrations`);
      continue;
    }
    if (m.rls !== d.rls) {
      differences.push(`${name}: row level security is ${m.rls ? "enabled" : "disabled"} in the migrations but ${d.rls ? "enabled" : "disabled"} in the Drizzle schema`);
    }
    if (m.forceRls !== d.forceRls) {
      differences.push(`${name}: forced row level security differs (migrations ${m.forceRls}, Drizzle ${d.forceRls})`);
    }
    const columns = [...new Set([...Object.keys(m.columns), ...Object.keys(d.columns)])].sort();
    for (const column of columns) {
      const mc = m.columns[column];
      const dc = d.columns[column];
      if (!dc) {
        differences.push(`${name}.${column} is in the migrations but not in the Drizzle schema`);
        continue;
      }
      if (!mc) {
        differences.push(`${name}.${column} is in the Drizzle schema but not in the migrations`);
        continue;
      }
      for (const key of ["type", "notNull", "default", "identity", "generated"]) {
        if (mc[key] !== dc[key]) {
          differences.push(`${name}.${column}: ${key} is ${JSON.stringify(mc[key])} in the migrations but ${JSON.stringify(dc[key])} in the Drizzle schema`);
        }
      }
    }
    differences.push(...diffSets(name, "constraint", m.constraints, d.constraints));
    differences.push(...diffSets(name, "index", m.indexes, d.indexes));
    differences.push(...diffSets(name, "policy", m.policies, d.policies));
  }
  const enums = [...new Set([...Object.keys(migrated.enums), ...Object.keys(drizzle.enums)])].sort();
  for (const name of enums) {
    const m = JSON.stringify(migrated.enums[name] ?? null);
    const d = JSON.stringify(drizzle.enums[name] ?? null);
    if (m !== d) differences.push(`enum ${name} is ${m} in the migrations but ${d} in the Drizzle schema`);
  }
  return differences;
}

/** The DDL drizzle-kit would write for a schema, from nothing. */
export async function drizzleDdl(imports) {
  return generateMigration(generateDrizzleJson({}), generateDrizzleJson(imports));
}

/**
 * Compares the Drizzle schema with a migrated database.
 *
 * @param {string} migratedUrl  a database to which every migration has been applied
 * @param {Record<string, unknown>} imports  the Drizzle tables, enums and schemas
 * @returns {Promise<string[]>} differences
 */
export async function findSchemaDrift(migratedUrl, imports) {
  const migrated = postgres(migratedUrl, { max: 1, onnotice: () => {} });
  const scratchName = `drift_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const scratchUrl = new URL(migratedUrl);
  scratchUrl.pathname = `/${scratchName}`;
  let scratch;
  try {
    await migrated.unsafe(`create database "${scratchName}"`);
    scratch = postgres(scratchUrl.href, { max: 1, onnotice: () => {} });

    // The scratch database gets the migrated one's app schemas and extensions
    // (pg_cron can only live in one database), so Drizzle's DDL finds its types.
    const schemas = await migrated.unsafe(
      `select n.nspname from pg_namespace n where ${appSchemaCondition("n")} and n.nspname <> 'public'`,
    );
    for (const { nspname } of schemas) await scratch.unsafe(`create schema if not exists "${nspname}"`);
    const extensions = await migrated.unsafe(
      `select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
       where e.extname not in ('plpgsql', 'pg_cron')`,
    );
    for (const { extname, nspname } of extensions) {
      await scratch
        .unsafe(`create schema if not exists "${nspname}"; create extension if not exists "${extname}" with schema "${nspname}"`)
        .catch(() => {});
    }

    const statements = await drizzleDdl(imports);
    await scratch.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement.replace(/^CREATE SCHEMA "/, 'CREATE SCHEMA IF NOT EXISTS "'));
      }
    });

    return compareSchemas(await introspect(migrated), await introspect(scratch));
  } finally {
    await scratch?.end({ timeout: 5 });
    await migrated.unsafe(`drop database if exists "${scratchName}" with (force)`).catch(() => {});
    await migrated.end({ timeout: 5 });
  }
}
