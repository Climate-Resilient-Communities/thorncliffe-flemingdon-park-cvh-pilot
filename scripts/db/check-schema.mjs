#!/usr/bin/env node
// Checks a migrated database (S01.03, AD-2):
//  - RLS: every app table has row level security enabled and no policy that
//    applies to anon or authenticated (a policy for PUBLIC applies to both).
//    The app reaches its tables only through the server's own connection.
//  - Ownership: every app table is listed in the spine's table ownership table;
//    a table in a schema named after a module must be owned by that module.
//
// Usage: MIGRATE_DATABASE_URL=postgres://... node scripts/db/check-schema.mjs

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { migrationRelationCondition, notExtensionMember } from "./schemas.mjs";

const require = createRequire(import.meta.url);
const { readTableOwnership } = require("../table-ownership.cjs");

// Supabase's client roles. A role "reaches" a relation, policy or owner when it
// is that role or a member of it (directly or through other roles).
const CLIENT_ROLES = ["anon", "authenticated"];
const CLIENTS = `(select oid from pg_roles where rolname in (${CLIENT_ROLES.map((r) => `'${r}'`).join(", ")}))`;
const PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER";

/**
 * The app's relations must not be readable by Supabase's client roles:
 *  - every table has RLS enabled, no policy that applies to anon or
 *    authenticated (a policy for PUBLIC, or for a role either is a member of),
 *    and no client role as its owner (RLS does not apply to the owner);
 *  - no view, materialized view or foreign table is reachable by a client
 *    role, since none of them applies the RLS of the tables behind it, except
 *    a security_invoker view, which does. Supabase's default privileges grant
 *    every new relation in public to anon and authenticated, so a view must
 *    revoke them or be security_invoker.
 *
 * @param {import("postgres").Sql} sql
 * @returns {Promise<string[]>}
 */
export async function checkRls(sql) {
  const relations = await sql.unsafe(`
    select n.nspname as schema, c.relname as table, c.relkind as kind, c.relrowsecurity as rls,
           coalesce(lower(array_to_string(c.reloptions, ',')) ~ '(^|,)security_invoker=(true|on|1|yes)($|,)', false) as invoker,
           (select array_agg(r.rolname order by r.rolname) from pg_roles r
             where r.oid in ${CLIENTS} and pg_has_role(r.oid, c.relowner, 'MEMBER'))::text[] as owned_by_clients,
           (select array_agg(r.rolname order by r.rolname) from pg_roles r
             where r.oid in ${CLIENTS} and has_table_privilege(r.oid, c.oid, '${PRIVILEGES}'))::text[] as reachable_by
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and ${migrationRelationCondition("c", "n", { includeHistory: true })} and ${notExtensionMember("c")}
    order by 1, 2`);
  const policies = await sql.unsafe(`
    select n.nspname as schema, c.relname as table, p.polname as policy,
           array(
             select case when r = 0 then 'public' else pg_get_userbyid(r) || coalesce(
                      (select ' (' || string_agg(cr.rolname, ' and ' order by cr.rolname)
                              || case when count(*) > 1 then ' are members)' else ' is a member)' end
                       from pg_roles cr where cr.oid in ${CLIENTS} and cr.oid <> r and pg_has_role(cr.oid, r, 'MEMBER')),
                      '') end
             from unnest(p.polroles) r
             where r = 0 or exists (select 1 from pg_roles cr where cr.oid in ${CLIENTS} and pg_has_role(cr.oid, r, 'MEMBER'))
           )::text[] as exposed
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
    where ${migrationRelationCondition("c", "n", { includeHistory: true })}
    order by 1, 2, 3`);

  const KINDS = { v: "view", m: "materialized view", f: "foreign table" };
  const problems = [];
  for (const t of relations) {
    const name = `${t.schema}.${t.table}`;
    if (t.kind === "r" || t.kind === "p") {
      if (!t.rls) {
        problems.push(`${name} has row level security disabled: add "alter table ${name} enable row level security"`);
      }
      if (t.owned_by_clients?.length) {
        problems.push(`${name} is owned by ${t.owned_by_clients.join(", ")}, to which its row level security does not apply`);
      }
    } else if (t.reachable_by?.length && !(t.kind === "v" && t.invoker)) {
      problems.push(
        `${name} is a ${KINDS[t.kind]} that ${t.reachable_by.join(" and ")} can read, without the row level security ` +
          `of the tables behind it: add "revoke all on ${name} from anon, authenticated"` +
          (t.kind === "v" ? ` or create it "with (security_invoker = true)"` : ""),
      );
    }
  }
  for (const p of policies) {
    if (p.exposed.length === 0) continue;
    problems.push(
      `${p.schema}.${p.table} has policy "${p.policy}" for ${p.exposed.join(", ")}: ` +
        `no anon or authenticated policies (a policy without TO applies to PUBLIC, which includes them)`,
    );
  }
  return problems;
}

/**
 * @param {import("postgres").Sql} sql
 * @param {Record<string, string>} owners table name -> owning module
 * @returns {Promise<string[]>}
 */
export async function checkOwnership(sql, owners) {
  const modules = new Set(Object.values(owners));
  const tables = await sql.unsafe(`
    select n.nspname as schema, c.relname as table
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'f') and ${migrationRelationCondition("c", "n")} and ${notExtensionMember("c")}
      and not c.relispartition
    order by 1, 2`);
  const problems = [];
  for (const { schema, table } of tables) {
    const owner = owners[table];
    if (!owner) {
      problems.push(
        `${schema}.${table} is not in the table ownership table of docs/architecture/ARCHITECTURE-SPINE.md (AD-2): ` +
          `add it to its owning module's row in a spine update`,
      );
    } else if (modules.has(schema) && schema !== owner) {
      problems.push(`${schema}.${table} is in the ${schema} schema but is owned by ${owner} (AD-2)`);
    }
  }
  return problems;
}

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) {
    console.error("MIGRATE_DATABASE_URL is not set");
    process.exitCode = 1;
    return;
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const sections = [
      ["Row level security", await checkRls(sql)],
      ["Table ownership", await checkOwnership(sql, readTableOwnership())],
    ];
    for (const [title, problems] of sections) {
      if (problems.length === 0) {
        console.log(`${title}: ok`);
        continue;
      }
      process.exitCode = 1;
      console.error(`${title}: ${problems.length} problem(s)`);
      for (const problem of problems) {
        console.error(`  - ${problem}`);
        if (process.env.GITHUB_ACTIONS === "true") console.log(`::error title=${title}::${problem}`);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
