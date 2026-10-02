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
import { appSchemaCondition, notExtensionMember } from "./schemas.mjs";

const require = createRequire(import.meta.url);
const { readTableOwnership } = require("../table-ownership.cjs");

const CLIENT_ROLES = ["anon", "authenticated", "public"];

/** @param {import("postgres").Sql} sql @returns {Promise<string[]>} */
export async function checkRls(sql) {
  const tables = await sql.unsafe(`
    select n.nspname as schema, c.relname as table, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and ${appSchemaCondition("n", { includeHistory: true })} and ${notExtensionMember("c")}
    order by 1, 2`);
  const policies = await sql.unsafe(`
    select p.schemaname as schema, p.tablename as table, p.policyname as policy, p.roles::text[] as roles
    from pg_policies p join pg_namespace n on n.nspname = p.schemaname
    where ${appSchemaCondition("n", { includeHistory: true })}
    order by 1, 2, 3`);

  const problems = [];
  for (const t of tables) {
    if (!t.rls) {
      problems.push(`${t.schema}.${t.table} has row level security disabled: add "alter table ${t.schema}.${t.table} enable row level security"`);
    }
  }
  for (const p of policies) {
    const exposed = p.roles.filter((role) => CLIENT_ROLES.includes(role));
    if (exposed.length > 0) {
      problems.push(
        `${p.schema}.${p.table} has policy "${p.policy}" for ${exposed.join(", ")}: ` +
          `no anon or authenticated policies (a policy without TO applies to PUBLIC, which includes them)`,
      );
    }
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
    where c.relkind in ('r', 'p', 'f') and ${appSchemaCondition("n")} and ${notExtensionMember("c")}
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
