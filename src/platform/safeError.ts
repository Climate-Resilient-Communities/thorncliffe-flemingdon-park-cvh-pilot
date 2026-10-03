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
 * The safe classification of `error`: its own `safeDetail`, else the first issue path of a zod error (`schema:providers.0.x`),
 * else the Postgres SQLSTATE (`code`, five characters), else the constructor name (letters, at most 40), else `unknown`.
 */
export function classifyError(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const e = error as { safeDetail?: unknown; issues?: unknown; code?: unknown; constructor?: { name?: unknown } };
  if (typeof e.safeDetail === "string" && SAFE_ERROR_PATTERN.test(e.safeDetail)) return e.safeDetail;
  if (Array.isArray(e.issues) && e.issues.every((i) => Array.isArray((i as { path?: unknown })?.path))) {
    return schemaFailure("schema", e.issues as ReadonlyArray<{ path: PropertyKey[] }>);
  }
  if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  const name = e.constructor?.name;
  return typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name) ? name : "unknown";
}
