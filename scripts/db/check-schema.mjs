#!/usr/bin/env node
// Checks a migrated database (S01.03, AD-2):
//  - RLS: every app table has row level security enabled and no policy that
//    applies to anon or authenticated (a policy for PUBLIC applies to both).
//    The app reaches its tables only through the server's own connection.
//  - Ownership: every app table is listed in the spine's table ownership table;
//    a table in a schema named after a module must be owned by that module.
//  - Network access: no function, procedure or view of the app that references
//    the net schema (pg_net: net.http_post and the like) is executable or
//    selectable by anon or authenticated, directly or through PUBLIC. pg_net's
//    own objects cannot be revoked (supabase_admin owns them), so the app's
//    wrappers around them are checked instead.
//  - Sequences: no sequence of the app (an identity column's included) is
//    usable by anon, authenticated or PUBLIC. Supabase's default privileges
//    grant them every new sequence, and nextval() or setval() by a client
//    would burn ids or rewrite the counter.
//  - Functions: no function or procedure of the app (an extension's excluded) is
//    executable by anon or authenticated, directly or through PUBLIC. PostgreSQL
//    grants EXECUTE on every new function to PUBLIC, and Supabase's default
//    privileges grant it to anon and authenticated as well.
//  - SECURITY DEFINER: every such function of the app pins its search_path
//    (a SET search_path in the function), or a caller could shadow the objects
//    it uses with their own.
//  - Column privileges: no column of an app relation is granted to anon,
//    authenticated or PUBLIC column by column, which the table-level checks
//    above (RLS, views) do not see.
//
// Usage: MIGRATE_DATABASE_URL=postgres://... node scripts/db/check-schema.mjs

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { appSchemaCondition, migrationRelationCondition, notExtensionMember } from "./schemas.mjs";

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

// A reference to the net schema in a definition: net.http_post, "net"."http_get", net._http_response.
const NET_REFERENCE = String.raw`\m"?net"?[[:space:]]*\.[[:space:]]*"?[a-z_]`;

/**
 * pg_net lets the database make HTTP requests, and its net.* functions cannot
 * be revoked from clients (supabase_admin owns them). So no function, procedure,
 * view or materialized view of the app that references the net schema may be
 * executable (functions) or selectable (views) by anon or authenticated, whether
 * granted to them, to a role they belong to, or to PUBLIC. A SECURITY DEFINER
 * function is no exception: it is how a client would borrow the owner's access.
 * Functions only service_role and postgres can execute pass.
 *
 * @param {import("postgres").Sql} sql
 * @returns {Promise<string[]>}
 */
export async function checkNetAccess(sql) {
  const functions = await sql.unsafe(`
    select n.nspname as schema, p.proname as name, p.prokind as kind,
           pg_get_function_identity_arguments(p.oid) as args,
           (select array_agg(r.rolname order by r.rolname) from pg_roles r
             where r.oid in ${CLIENTS} and has_function_privilege(r.oid, p.oid, 'EXECUTE'))::text[] as reachable_by
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind in ('f', 'p') and ${appSchemaCondition("n")}
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      and pg_get_functiondef(p.oid) ~* '${NET_REFERENCE}'
    order by 1, 2, 4`);
  const views = await sql.unsafe(`
    select n.nspname as schema, c.relname as name, c.relkind as kind,
           (select array_agg(r.rolname order by r.rolname) from pg_roles r
             where r.oid in ${CLIENTS} and has_table_privilege(r.oid, c.oid, 'SELECT'))::text[] as reachable_by
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('v', 'm') and ${appSchemaCondition("n")} and ${notExtensionMember("c")}
      and (pg_get_viewdef(c.oid) ~* '${NET_REFERENCE}'
        or exists (select 1 from pg_depend d
                   join pg_rewrite rw on rw.oid = d.objid
                   join pg_class dc on dc.oid = d.refobjid
                   join pg_namespace dn on dn.oid = dc.relnamespace
                   where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
                     and rw.ev_class = c.oid and dn.nspname = 'net'))
    order by 1, 2`);

  const problems = [];
  for (const f of functions) {
    if (!f.reachable_by?.length) continue;
    const signature = `${f.schema}.${f.name}(${f.args})`;
    problems.push(
      `${signature} uses the net schema (pg_net) and ${f.reachable_by.join(" and ")} can execute it: ` +
        `add "revoke all on ${f.kind === "p" ? "procedure" : "function"} ${signature} from public, anon, authenticated"`,
    );
  }
  for (const v of views) {
    if (!v.reachable_by?.length) continue;
    const name = `${v.schema}.${v.name}`;
    problems.push(
      `${name} is a ${v.kind === "m" ? "materialized view" : "view"} on the net schema (pg_net) that ${v.reachable_by.join(" and ")} can read: ` +
        `add "revoke all on ${name} from public, anon, authenticated"`,
    );
  }
  return problems;
}

/**
 * No sequence in an app schema may hold any privilege (USAGE, SELECT, UPDATE)
 * for anon, authenticated (or a role either is a member of) or PUBLIC. The
 * ACL is read directly, since has_sequence_privilege cannot ask about PUBLIC.
 *
 * @param {import("postgres").Sql} sql
 * @returns {Promise<string[]>}
 */
export async function checkSequences(sql) {
  const rows = await sql.unsafe(`
    select n.nspname as schema, c.relname as name,
           (select array_agg(distinct case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end
                             order by case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end)
            from aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
            where a.privilege_type in ('USAGE', 'SELECT', 'UPDATE')
              and (a.grantee = 0 or exists (select 1 from pg_roles cr where cr.oid in ${CLIENTS} and pg_has_role(cr.oid, a.grantee, 'MEMBER'))))::text[] as reachable_by
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'S' and ${migrationRelationCondition("c", "n")} and ${notExtensionMember("c")}
    order by 1, 2`);
  return rows
    .filter((r) => r.reachable_by?.length)
    .map(
      (r) =>
        `${r.schema}.${r.name} is a sequence that ${r.reachable_by.join(" and ")} can use: ` +
        `add "revoke all on sequence ${r.schema}.${r.name} from public, anon, authenticated, service_role"`,
    );
}

const routineKind = (kind) => (kind === "p" ? "procedure" : "function");

/**
 * No function or procedure of the app may be executable by anon or
 * authenticated, granted to them, to a role they belong to, or to PUBLIC
 * (which PostgreSQL gives every new function). Functions owned by an extension
 * are not the app's.
 *
 * @param {import("postgres").Sql} sql
 * @returns {Promise<string[]>}
 */
export async function checkFunctionExecute(sql) {
  const rows = await sql.unsafe(`
    select n.nspname as schema, p.proname as name, p.prokind as kind,
           pg_get_function_identity_arguments(p.oid) as args,
           (select array_agg(r.rolname order by r.rolname) from pg_roles r
             where r.oid in ${CLIENTS} and has_function_privilege(r.oid, p.oid, 'EXECUTE'))::text[] as reachable_by
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind in ('f', 'p') and ${appSchemaCondition("n")}
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    order by 1, 2, 4`);
  return rows
    .filter((f) => f.reachable_by?.length)
    .map((f) => {
      const signature = `${f.schema}.${f.name}(${f.args})`;
      return (
        `${signature} is a ${routineKind(f.kind)} that ${f.reachable_by.join(" and ")} can execute: ` +
        `add "revoke all on ${routineKind(f.kind)} ${signature} from public, anon, authenticated"`
      );
    });
}

/**
 * A SECURITY DEFINER function runs with its owner's rights, so the objects it
 * names must not be replaceable by the caller: it has to carry its own
 * `set search_path` (proconfig).
 *
 * @param {import("postgres").Sql} sql
 * @returns {Promise<string[]>}
 */
export async function checkSecurityDefiner(sql) {
  const rows = await sql.unsafe(`
    select n.nspname as schema, p.proname as name, p.prokind as kind, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind in ('f', 'p') and p.prosecdef and ${appSchemaCondition("n")}
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c ~* '^search_path=')
    order by 1, 2, 4`);
  return rows.map((f) => {
    const signature = `${f.schema}.${f.name}(${f.args})`;
    return (
      `${signature} is a SECURITY DEFINER ${routineKind(f.kind)} without a pinned search_path: ` +
      `add "set search_path = ''" to its definition and name every object with its schema`
    );
  });
}

/**
 * No column of an app relation may carry a privilege of its own for anon,
 * authenticated, a role either belongs to, or PUBLIC. The table-level checks
 * (has_table_privilege) are false for such a relation, so it would pass them.
 *
 * @param {import("postgres").Sql} sql
 * @returns {Promise<string[]>}
 */
export async function checkColumnPrivileges(sql) {
  const rows = await sql.unsafe(`
    select n.nspname as schema, c.relname as name, a.attname as column,
           (select array_agg(distinct case when g.grantee = 0 then 'public' else pg_get_userbyid(g.grantee) end || ' ' || g.privilege_type)
            from aclexplode(a.attacl) g
            where g.grantee = 0 or exists (select 1 from pg_roles cr where cr.oid in ${CLIENTS} and pg_has_role(cr.oid, g.grantee, 'MEMBER')))::text[] as granted
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where a.attacl is not null and a.attnum > 0 and not a.attisdropped
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and ${migrationRelationCondition("c", "n", { includeHistory: true })} and ${notExtensionMember("c")}
    order by 1, 2, 3`);
  return rows
    .filter((r) => r.granted?.length)
    .map(
      (r) =>
        `${r.schema}.${r.name}.${r.column} has a column privilege (${r.granted.join(", ")}) for a client role: ` +
        `add "revoke all (${r.column}) on ${r.schema}.${r.name} from public, anon, authenticated"`,
    );
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
      ["Network access", await checkNetAccess(sql)],
      ["Sequences", await checkSequences(sql)],
      ["Function execute", await checkFunctionExecute(sql)],
      ["Security definer", await checkSecurityDefiner(sql)],
      ["Column privileges", await checkColumnPrivileges(sql)],
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
