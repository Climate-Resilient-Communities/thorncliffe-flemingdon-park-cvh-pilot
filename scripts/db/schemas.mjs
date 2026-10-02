// Which schemas hold the app's tables. Everything else in the database is
// PostgreSQL's or Supabase's: the checks and the drift test ignore it.

/** The migration runner's history: platform-owned, locked down by the runner itself. */
export const HISTORY_SCHEMA = "cvh_migrations";
export const HISTORY_TABLE = "applied";

/** Schemas created and managed by PostgreSQL, Supabase or extensions. */
export const SYSTEM_SCHEMAS = [
  "information_schema",
  "auth",
  "storage",
  "realtime",
  "_realtime",
  "_analytics",
  "vault",
  "extensions",
  "graphql",
  "graphql_public",
  "pgbouncer",
  "pgsodium",
  "pgsodium_masks",
  "supabase_functions",
  "supabase_migrations",
  "net",
  "cron",
  "pgtle",
];

/**
 * SQL condition on a pg_namespace alias that keeps only app schemas.
 * Schemas starting with pg_ (pg_catalog, pg_toast, temporary schemas) are PostgreSQL's.
 *
 * @param {string} alias
 * @param {{ includeHistory?: boolean }} [options]
 */
export function appSchemaCondition(alias, { includeHistory = false } = {}) {
  const excluded = includeHistory ? SYSTEM_SCHEMAS : [...SYSTEM_SCHEMAS, HISTORY_SCHEMA];
  const list = excluded.map((s) => `'${s}'`).join(", ");
  return `(${alias}.nspname not like 'pg\\_%' and ${alias}.nspname not in (${list}))`;
}

/**
 * SQL condition on pg_class and pg_namespace aliases that keeps the relations
 * migrations create: those in app schemas, and those placed in a PostgreSQL,
 * Supabase or extension schema but owned by the migrating role or a client
 * role. Without the second part a table created in, say, `extensions` would
 * escape the RLS and ownership checks. The checks run on CI's disposable
 * database, where Supabase's own relations belong to Supabase's roles.
 *
 * @param {string} classAlias
 * @param {string} namespaceAlias
 * @param {{ includeHistory?: boolean }} [options]
 */
export function migrationRelationCondition(classAlias, namespaceAlias, options = {}) {
  const system = SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(", ");
  return (
    `(${appSchemaCondition(namespaceAlias, options)} or (${namespaceAlias}.nspname in (${system}) ` +
    `and pg_get_userbyid(${classAlias}.relowner) in (session_user::text, 'anon', 'authenticated', 'service_role')))`
  );
}

/** SQL condition on a pg_class alias that drops relations owned by an extension (cron.job and the like). */
export function notExtensionMember(alias) {
  return `not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = ${alias}.oid and d.deptype = 'e')`;
}
