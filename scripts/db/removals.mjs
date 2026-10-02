// What a migration removed or tightened, read from the database rather than its
// text (S01.03 expand/contract rule). The text check (sql.mjs) cannot see a
// table dropped inside a DO block, by EXECUTE, by a function the migration
// calls, or as a side effect of DROP TYPE ... CASCADE. Comparing the database
// before and after each migration, inside its own transaction, sees all of them.
// A rename shows as a removal of the old name.
//
// "Destructive" here means: the release that is still serving while the
// migration runs (it was built for the schema before) can fail or lose access.
// The snapshot holds, for the app's own objects:
//   - tables with their columns (type, nullability, default) and row level security,
//   - table constraints (check, foreign key, unique, primary key, exclusion),
//   - policies,
//   - what the app role cvh_app can do: table, sequence and function privileges, schema usage,
//   - views and materialized views, functions and procedures, enum labels,
//   - the non-internal triggers of each table (name, timing, events, function).
// Additions that only widen what the previous release can do are not reported.

import { appSchemaCondition, migrationRelationCondition, notExtensionMember } from "./schemas.mjs";

/** The role the app connects through (migration 20261002010000_audit_event.sql). */
export const APP_ROLE = "cvh_app";

const TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const SEQUENCE_PRIVILEGES = ["USAGE", "SELECT", "UPDATE"];
const list = (items) => `array[${items.map((i) => `'${i}'`).join(", ")}]`;

const notExtensionRoutine = (alias) =>
  `not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = ${alias}.oid and d.deptype = 'e')`;
const notExtensionType = (alias) =>
  `not exists (select 1 from pg_depend d where d.classid = 'pg_type'::regclass and d.objid = ${alias}.oid and d.deptype = 'e')`;

const qualified = (schema, name) => `quote_ident(${schema}) || '.' || quote_ident(${name})`;

/**
 * @typedef {{ type: string, notNull: boolean, default: string | null }} ColumnState
 * @typedef {{
 *   tables: Record<string, { rls: boolean, columns: Record<string, ColumnState> }>,
 *   constraints: Record<string, Record<string, { def: string, columns: string[] }>>,
 *   policies: Record<string, Record<string, string>>,
 *   triggers: Record<string, Record<string, string>>,
 *   privileges: Record<string, string[]>,
 *   views: Record<string, string>,
 *   functions: Record<string, string>,
 *   enums: Record<string, string[]>,
 * }} Snapshot
 */

/**
 * @param {import("postgres").Sql | import("postgres").TransactionSql} sql
 * @returns {Promise<Snapshot>}
 */
export async function snapshotColumns(sql) {
  const relation = (alias, namespace) => `${migrationRelationCondition(alias, namespace)} and ${notExtensionMember(alias)}`;
  const role = `(select oid from pg_roles where rolname = '${APP_ROLE}')`;

  const columnRows = await sql.unsafe(`
    select ${qualified("n.nspname", "c.relname")} as "table", c.relrowsecurity as rls,
           a.attname as "column", format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as not_null,
           case when a.attidentity <> '' then 'identity ' || a.attidentity::text
                when a.attgenerated <> '' then 'generated ' || pg_get_expr(d.adbin, d.adrelid)
                else pg_get_expr(d.adbin, d.adrelid) end as "default"
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where c.relkind in ('r', 'p', 'f') and not c.relispartition and ${relation("c", "n")}`);
  const tables = {};
  for (const row of columnRows) {
    tables[row.table] ??= { rls: row.rls, columns: {} };
    if (row.column !== null) {
      tables[row.table].columns[row.column] = { type: row.type, notNull: row.not_null, default: row.default };
    }
  }

  const constraintRows = await sql.unsafe(`
    select ${qualified("n.nspname", "c.relname")} as "table", co.conname as name, pg_get_constraintdef(co.oid) as def,
           array(select a.attname from pg_attribute a where a.attrelid = co.conrelid and a.attnum = any (co.conkey)
                 order by a.attnum)::text[] as columns
    from pg_constraint co
    join pg_class c on c.oid = co.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where co.contype in ('c', 'f', 'u', 'p', 'x') and co.conparentid = 0
      and c.relkind in ('r', 'p', 'f') and ${relation("c", "n")}`);
  const constraints = {};
  for (const row of constraintRows) {
    (constraints[row.table] ??= {})[row.name] = { def: row.def, columns: row.columns };
  }

  const policyRows = await sql.unsafe(`
    select ${qualified("n.nspname", "c.relname")} as "table", p.polname as name,
           p.polcmd::text || ' ' || case when p.polpermissive then 'permissive' else 'restrictive' end
           || ' to ' || coalesce((select string_agg(case when r = 0 then 'public' else pg_get_userbyid(r) end, ', ' order by r)
                                  from unnest(p.polroles) r), '')
           || ' using ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-')
           || ' check ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') as def
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where ${relation("c", "n")}`);
  const policies = {};
  for (const row of policyRows) (policies[row.table] ??= {})[row.name] = row.def;

  // Triggers a table fires (not the internal ones behind foreign keys, nor copies on partitions). The
  // definition is timing, events and function, e.g. "after update of role, status -> public.f()".
  const triggerRows = await sql.unsafe(`
    select ${qualified("n.nspname", "c.relname")} as "table", t.tgname as name,
           case when t.tgtype & 2 <> 0 then 'before' when t.tgtype & 64 <> 0 then 'instead of' else 'after' end as timing,
           concat_ws(' or ',
             case when t.tgtype & 4 <> 0 then 'insert' end,
             case when t.tgtype & 8 <> 0 then 'delete' end,
             case when t.tgtype & 16 <> 0 then 'update' || coalesce(' of ' || (
               select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
               where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])), '') end,
             case when t.tgtype & 32 <> 0 then 'truncate' end) as events,
           ${qualified("pn.nspname", "p.proname")} as function
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal and t.tgparentid = 0
      and c.relkind in ('r', 'p', 'f') and ${relation("c", "n")}`);
  const triggers = {};
  for (const row of triggerRows) (triggers[row.table] ??= {})[row.name] = `${row.timing} ${row.events} -> ${row.function}()`;

  // Effective privileges of the app role (through PUBLIC and role membership too).
  const privileges = {};
  const addPrivileges = (rows, label) => {
    for (const row of rows) if (row.granted.length > 0) privileges[`${label} ${row.name}`] = row.granted;
  };
  addPrivileges(
    await sql.unsafe(`
      select ${qualified("n.nspname", "c.relname")} as name,
             array(select p from unnest(${list(TABLE_PRIVILEGES)}) p where has_table_privilege(r.oid, c.oid, p))::text[] as granted
      from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join ${role} as r(oid)
      where c.relkind in ('r', 'p', 'v', 'm', 'f') and ${relation("c", "n")}`),
    "table",
  );
  addPrivileges(
    await sql.unsafe(`
      select ${qualified("n.nspname", "c.relname")} as name,
             array(select p from unnest(${list(SEQUENCE_PRIVILEGES)}) p where has_sequence_privilege(r.oid, c.oid, p))::text[] as granted
      from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join ${role} as r(oid)
      where c.relkind = 'S' and ${relation("c", "n")}`),
    "sequence",
  );
  addPrivileges(
    await sql.unsafe(`
      select ${qualified("n.nspname", "p.proname")} || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
             array(select 'EXECUTE' where has_function_privilege(r.oid, p.oid, 'EXECUTE'))::text[] as granted
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join ${role} as r(oid)
      where p.prokind in ('f', 'p') and ${appSchemaCondition("n")} and ${notExtensionRoutine("p")}`),
    "function",
  );
  addPrivileges(
    await sql.unsafe(`
      select quote_ident(n.nspname) as name,
             array(select 'USAGE' where has_schema_privilege(r.oid, n.oid, 'USAGE'))::text[] as granted
      from pg_namespace n cross join ${role} as r(oid)
      where ${appSchemaCondition("n")}`),
    "schema",
  );

  const views = {};
  for (const row of await sql.unsafe(`
    select ${qualified("n.nspname", "c.relname")} as name, c.relkind as kind, pg_get_viewdef(c.oid) as def
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('v', 'm') and ${relation("c", "n")}`)) {
    views[`${row.kind === "m" ? "materialized view" : "view"} ${row.name}`] = row.def;
  }

  const functions = {};
  for (const row of await sql.unsafe(`
    select ${qualified("n.nspname", "p.proname")} || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
           p.prokind as kind,
           coalesce(pg_get_function_result(p.oid), '-') || case when p.prosecdef then ' security definer' else '' end as state
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind in ('f', 'p') and ${appSchemaCondition("n")} and ${notExtensionRoutine("p")}`)) {
    functions[`${row.kind === "p" ? "procedure" : "function"} ${row.name}`] = row.state;
  }

  const enums = {};
  for (const row of await sql.unsafe(`
    select ${qualified("n.nspname", "t.typname")} as name,
           coalesce(array_agg(e.enumlabel order by e.enumsortorder) filter (where e.enumlabel is not null), '{}')::text[] as labels
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    left join pg_enum e on e.enumtypid = t.oid
    where t.typtype = 'e' and ${appSchemaCondition("n")} and ${notExtensionType("t")}
    group by n.nspname, t.typname`)) {
    enums[row.name] = row.labels;
  }

  return { tables, constraints, policies, triggers, privileges, views, functions, enums };
}

const byName = ([a], [b]) => a.localeCompare(b);
const NOT_VALID = / NOT VALID$/;

/**
 * What applying a migration removed from the database or tightened for the
 * release that was already running, one description per change.
 *
 * @param {Snapshot} before
 * @param {Snapshot} after
 * @returns {string[]}
 */
export function compareColumns(before, after) {
  const changes = [];

  for (const [table, was] of Object.entries(before.tables).sort(byName)) {
    const now = after.tables[table];
    if (!now) {
      changes.push(`removes table ${table} (dropped, renamed or moved)`);
      continue;
    }
    for (const [column, state] of Object.entries(was.columns).sort(byName)) {
      const next = now.columns[column];
      if (!next) {
        changes.push(`removes column ${table}.${column} (dropped or renamed)`);
        continue;
      }
      if (next.type !== state.type) {
        changes.push(`changes the type of column ${table}.${column} from ${state.type} to ${next.type} (may narrow it)`);
      }
      if (next.notNull && !state.notNull) {
        changes.push(`makes column ${table}.${column} not null (the previous release may still write nulls)`);
      }
      if (state.default !== null && next.default !== state.default) {
        changes.push(
          next.default === null
            ? `drops the default of column ${table}.${column} (the previous release may rely on it)`
            : `changes the default of column ${table}.${column} (the previous release may rely on it)`,
        );
      }
    }
    for (const [column, next] of Object.entries(now.columns).sort(byName)) {
      if (!(column in was.columns) && next.notNull && next.default === null) {
        changes.push(`adds column ${table}.${column} as not null without a default (the previous release does not write it)`);
      }
    }
    if (was.rls && !now.rls) changes.push(`disables row level security on ${table}`);
  }

  for (const table of [...new Set([...Object.keys(before.constraints), ...Object.keys(before.tables)])].sort()) {
    if (!before.tables[table] || !after.tables[table]) continue;
    const was = before.constraints[table] ?? {};
    const now = after.constraints[table] ?? {};
    const known = new Set(Object.values(was).map((c) => c.def.replace(NOT_VALID, "")));
    for (const [name, c] of Object.entries(now).sort(byName)) {
      if (NOT_VALID.test(c.def) || known.has(c.def)) continue;
      // A constraint on columns the migration added only binds writes to those columns.
      if (c.columns.length > 0 && c.columns.every((column) => !(column in before.tables[table].columns))) continue;
      changes.push(
        name in was
          ? `changes constraint ${name} on ${table} to ${c.def} (rows the previous release writes may violate it)`
          : `adds constraint ${name} on ${table}: ${c.def} (rows the previous release writes may violate it; add it NOT VALID and validate later)`,
      );
    }
  }

  for (const [table, was] of Object.entries(before.policies).sort(byName)) {
    if (!after.tables[table]) continue;
    const now = after.policies[table] ?? {};
    for (const [name, def] of Object.entries(was).sort(byName)) {
      if (!(name in now)) changes.push(`removes policy ${name} on ${table} (dropped or renamed)`);
      else if (now[name] !== def) changes.push(`changes policy ${name} on ${table}`);
    }
    for (const [name, def] of Object.entries(now).sort(byName)) {
      if (!(name in was) && def.includes(" restrictive ")) changes.push(`adds restrictive policy ${name} on ${table}`);
    }
  }

  // A trigger can raise, which the previous release's writes did not expect. A trigger on a table the
  // migration creates is not reported (before.tables lacks it): nothing wrote to that table before.
  // A migration with a `-- contract:` note is then checked against the release in production (contracts.mjs).
  for (const table of Object.keys(before.tables).sort()) {
    if (!after.tables[table]) continue;
    const was = before.triggers[table] ?? {};
    for (const [name, def] of Object.entries(after.triggers[table] ?? {}).sort(byName)) {
      if (!(name in was)) {
        changes.push(
          `adds trigger ${name} on ${table} (${def}), which can raise on writes the previous release makes (add a "-- contract: <commit SHA>" note once that release is in production, or create the trigger in the migration that creates the table)`,
        );
      } else if (was[name] !== def) {
        changes.push(`changes trigger ${name} on ${table} from (${was[name]}) to (${def}) (it can raise on writes the previous release makes)`);
      }
    }
  }

  for (const [object, was] of Object.entries(before.privileges).sort(byName)) {
    const kind = object.slice(0, object.indexOf(" "));
    const name = object.slice(object.indexOf(" ") + 1);
    // A removed relation is reported as removed; its privileges went with it.
    if (kind === "table" && !after.tables[name] && !(`view ${name}` in after.views) && !(`materialized view ${name}` in after.views)) continue;
    if (kind === "function" && !(`function ${name}` in after.functions) && !(`procedure ${name}` in after.functions)) continue;
    const lost = was.filter((privilege) => !(after.privileges[object] ?? []).includes(privilege));
    if (lost.length > 0) changes.push(`revokes ${lost.join(", ")} on ${kind} ${name} from ${APP_ROLE}`);
  }

  for (const [view, def] of Object.entries(before.views).sort(byName)) {
    if (!(view in after.views)) changes.push(`removes ${view} (dropped, renamed or moved)`);
    else if (after.views[view] !== def) changes.push(`changes the definition of ${view}`);
  }

  for (const [routine, state] of Object.entries(before.functions).sort(byName)) {
    if (!(routine in after.functions)) changes.push(`removes ${routine} (dropped, renamed or its signature changed)`);
    else if (after.functions[routine] !== state) {
      changes.push(`changes the result or security of ${routine} from "${state}" to "${after.functions[routine]}"`);
    }
  }

  for (const [type, labels] of Object.entries(before.enums).sort(byName)) {
    const now = after.enums[type];
    if (!now) {
      changes.push(`removes enum type ${type} (dropped, renamed or moved)`);
      continue;
    }
    for (const label of labels) {
      if (!now.includes(label)) changes.push(`removes value '${label}' from enum type ${type} (dropped or renamed)`);
    }
  }

  return changes;
}
