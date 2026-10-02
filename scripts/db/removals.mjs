// What a migration removed, read from the database rather than its text
// (S01.03 expand/contract rule). The text check (sql.mjs) cannot see a table
// dropped inside a DO block, by EXECUTE, by a function the migration calls, or
// as a side effect of DROP TYPE ... CASCADE. Comparing the tables and columns
// before and after each migration, inside its own transaction, sees all of
// them. A rename shows as a removal of the old name.

import { migrationRelationCondition, notExtensionMember } from "./schemas.mjs";

/**
 * Tables (and foreign tables) with their columns and types.
 *
 * @param {import("postgres").Sql | import("postgres").TransactionSql} sql
 * @returns {Promise<Record<string, Record<string, string>>>} "schema.table" -> column -> type
 */
export async function snapshotColumns(sql) {
  const rows = await sql.unsafe(`
    select quote_ident(n.nspname) || '.' || quote_ident(c.relname) as table,
           a.attname as column, format_type(a.atttypid, a.atttypmod) as type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('r', 'p', 'f') and not c.relispartition
      and ${migrationRelationCondition("c", "n")} and ${notExtensionMember("c")}`);
  const tables = {};
  for (const row of rows) {
    tables[row.table] ??= {};
    if (row.column !== null) tables[row.table][row.column] = row.type;
  }
  return tables;
}

/**
 * @param {Record<string, Record<string, string>>} before
 * @param {Record<string, Record<string, string>>} after
 * @returns {string[]} one description per removed table, removed column or changed type
 */
export function compareColumns(before, after) {
  const changes = [];
  for (const [table, columns] of Object.entries(before).sort(([a], [b]) => a.localeCompare(b))) {
    const now = after[table];
    if (!now) {
      changes.push(`removes table ${table} (dropped, renamed or moved)`);
      continue;
    }
    for (const [column, type] of Object.entries(columns).sort(([a], [b]) => a.localeCompare(b))) {
      if (!(column in now)) {
        changes.push(`removes column ${table}.${column} (dropped or renamed)`);
      } else if (now[column] !== type) {
        changes.push(`changes the type of column ${table}.${column} from ${type} to ${now[column]} (may narrow it)`);
      }
    }
  }
  return changes;
}
