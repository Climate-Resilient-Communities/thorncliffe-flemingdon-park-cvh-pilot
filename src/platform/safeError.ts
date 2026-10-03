// A classification of an error that is safe to store in an ops event and write to a log: never its message, and never anything
// a caller put in it (an address, a hash, a question). The result always matches SAFE_ERROR_PATTERN.

/** What a safe classification looks like: letters, digits and `_ . :`, at most 80 characters. */
export const SAFE_ERROR_PATTERN = /^[A-Za-z0-9_.:]{1,80}$/;

/** A zod-style issue path as `providers.0.neighbourhood_ids`: segments reduced to `[A-Za-z0-9_.]`, the whole capped at 80 characters. */
export function sanitisePath(path: readonly PropertyKey[], max = 80): string {
  return path
    .map((segment) => String(typeof segment === "symbol" ? "symbol" : segment).replace(/[^A-Za-z0-9_.]/g, "_"))
    .join(".")
    .slice(0, max);
}

/** `prefix:path` of the first issue of a failed zod parse, e.g. `listing_schema:providers.0.neighbourhood_ids`. */
export function schemaFailure(prefix: string, issues: ReadonlyArray<{ path: readonly PropertyKey[] }>): string {
  const path = sanitisePath(issues[0]?.path ?? []);
  return `${prefix}${path ? `:${path}` : ""}`.slice(0, 80);
}

/** An error that already carries its own safe classification (`safeDetail`). */
export class SafeDetailError extends Error {
  constructor(readonly safeDetail: string) {
    super("failure");
    this.name = "SafeDetailError";
  }
}

/**
 * The Postgres SQLSTATE of `error`: its `code` when that is five characters of `0-9A-Z`, else that of its `cause` (the database
 * client's error wrapped by drizzle's DrizzleQueryError, whose own message holds the query and its parameters and is never used).
 */
function sqlState(error: unknown, depth = 0): string | null {
  if (typeof error !== "object" || error === null || depth > 2) return null;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  return sqlState(cause, depth + 1);
}

/**
 * The safe classification of `error`: its own `safeDetail`, else the first issue path of a zod error (`schema:providers.0.x`),
 * else the Postgres SQLSTATE (five characters; of the error or, through drizzle's wrapper, of its cause), else the constructor
 * name (letters, at most 40), else `unknown`.
 */
export function classifyError(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const e = error as { safeDetail?: unknown; issues?: unknown; code?: unknown; constructor?: { name?: unknown } };
  if (typeof e.safeDetail === "string" && SAFE_ERROR_PATTERN.test(e.safeDetail)) return e.safeDetail;
  if (Array.isArray(e.issues) && e.issues.every((i) => Array.isArray((i as { path?: unknown })?.path))) {
    return schemaFailure("schema", e.issues as ReadonlyArray<{ path: PropertyKey[] }>);
  }
  const state = sqlState(error);
  if (state !== null) return state;
  const name = e.constructor?.name;
  return typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name) ? name : "unknown";
}
