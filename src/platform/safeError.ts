// A classification of an error that is safe to store in an ops event and write to a log: never its message, and never anything
// a caller put in it (an address, a hash, a question). The result always satisfies isSafeError (src/contracts/safeError.ts).
import { isSafeError } from "@/contracts/safeError";

/** A zod-style issue path as `providers.0.neighbourhood_ids`: segments reduced to `[A-Za-z0-9_.]`, the whole capped at 80 characters. */
export function sanitisePath(path: readonly PropertyKey[], max = 80): string {
  return path
    .map((segment) => String(typeof segment === "symbol" ? "symbol" : segment).replace(/[^A-Za-z0-9_.]/g, "_"))
    .join(".")
    .slice(0, max);
}

/**
 * `prefix:path` of the first issue of a failed zod parse, e.g. `listing_schema:providers.0.neighbourhood_ids`. A path that is
 * not a safe classification (a key of the parsed data that looks like an address) is left out: the prefix alone is then told.
 */
export function schemaFailure(prefix: string, issues: ReadonlyArray<{ path: readonly PropertyKey[] }>): string {
  const path = sanitisePath(issues[0]?.path ?? []);
  const full = `${prefix}${path ? `:${path}` : ""}`.slice(0, 80);
  return isSafeError(full) ? full : prefix;
}

/** An error that already carries its own safe classification (`safeDetail`). */
export class SafeDetailError extends Error {
  constructor(readonly safeDetail: string) {
    super("failure");
    this.name = "SafeDetailError";
  }
}

/** How far down a chain of `cause`s a code is looked for: an error, the one wrapping it, and one more. */
const MAX_CAUSE_DEPTH = 2;

/**
 * The first `code` of `error`, or of its `cause`, that `matches`. Only `code` is read: the message of an error, and what drizzle's
 * DrizzleQueryError holds (the query and its parameters), never is.
 */
function codeOf(error: unknown, matches: (code: string) => boolean, depth = 0): string | null {
  if (typeof error !== "object" || error === null || depth > MAX_CAUSE_DEPTH) return null;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (typeof code === "string" && matches(code)) return code;
  return codeOf(cause, matches, depth + 1);
}

/** A Postgres SQLSTATE: five characters of `0-9A-Z`. */
const isSqlState = (code: string) => /^[0-9A-Z]{5}$/.test(code);
/** A library's constant code (`CONNECT_TIMEOUT`, `ECONNREFUSED`): the connection errors of the database client and of the network have these and no SQLSTATE. */
const isConstantCode = (code: string) => /^[A-Z][A-Z0-9_]{2,39}$/.test(code);

/** A name a class can be told by: letters, at most 40. */
const NAME = /^[A-Za-z]{1,40}$/;

/**
 * What drizzle wraps a failed query in, recognised by its shape (it has the query and its parameters; neither is read, only
 * that they are there), because its own `name` is the plain `Error` and a build that minifies renames its class.
 */
function isDrizzleQueryError(error: object): boolean {
  return "query" in error && "params" in error;
}

/**
 * The name of the class of `error`: the `name` it sets itself when that is a name and not the plain `Error` (the app's own
 * errors set one: QueryEmbedError, EnvError, and the built-in ones are TypeError, RangeError), else drizzle's wrapper by its
 * shape, else its constructor's name. The constructor's name is the last resort because a production build renames classes
 * (`class mu extends Error`), while a `name` is a string and survives.
 */
function classNameOf(error: object): string | null {
  const { name, constructor } = error as { name?: unknown; constructor?: { name?: unknown } };
  if (typeof name === "string" && name !== "Error" && NAME.test(name)) return name;
  if (isDrizzleQueryError(error)) return "DrizzleQueryError";
  const own = constructor?.name;
  return typeof own === "string" && NAME.test(own) ? own : null;
}

function classify(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const { safeDetail, issues } = error as { safeDetail?: unknown; issues?: unknown };
  if (isSafeError(safeDetail)) return safeDetail;
  if (Array.isArray(issues) && issues.every((i) => Array.isArray((i as { path?: unknown })?.path))) {
    return schemaFailure("schema", issues as ReadonlyArray<{ path: PropertyKey[] }>);
  }
  return codeOf(error, isSqlState) ?? codeOf(error, isConstantCode) ?? classNameOf(error) ?? "unknown";
}

/**
 * The safe classification of `error`: its own `safeDetail`, else the first issue path of a zod error (`schema:providers.0.x`),
 * else the Postgres SQLSTATE (five characters; of the error or, through drizzle's wrapper, of its cause), else a library's
 * constant code (`CONNECT_TIMEOUT`, `ECONNREFUSED`), else the class name (`QueryEmbedError`; see classNameOf), else `unknown`.
 * Never the message, and whatever it finds is checked against isSafeError before it leaves.
 */
export function classifyError(error: unknown): string {
  const found = classify(error);
  return isSafeError(found) ? found : "unknown";
}
