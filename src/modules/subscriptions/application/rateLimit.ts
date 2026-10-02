// The per-client rate limiter of the public endpoints (S03.04, AD-22): "at most `limit` requests per `windowMs` from one
// client", kept in Postgres against a keyed hash of the client's address, never the address (AD-13). Search uses it first
// (30 questions per 10 minutes); sign-up (E07) will use it with its own scope. Each allowed request is one `rate_limit` row,
// deleted after 24 hours; a refused request is not counted, so a client that waits out the window is served again.
import { createHmac } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { and, count, eq, gt, lt, min, sql } from "drizzle-orm";
import type { Db } from "@/platform/db";
import { rateLimit } from "../adapters/schema";

export interface RateLimitRule {
  /** lower_snake_case name of the endpoint the limit is for. */
  scope: string;
  limit: number;
  windowMs: number;
}

/** Search: more than 30 questions in 10 minutes from one client is refused (AD-22, S03.04). */
export const SEARCH_RATE_LIMIT: RateLimitRule = { scope: "search", limit: 30, windowMs: 10 * 60_000 };

/** A client's hash is deleted after this long (AD-13). */
export const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60_000;

// A fixed seed for the advisory locks of clients: the hash's 64-bit hash under this seed.
const RATE_LIMIT_LOCK_SEED = 5_204_913_377;

const hex = (n: number) => n.toString(16);

/** The eight 16-bit groups of an IPv6 address (compressed `::` and a trailing dotted IPv4 expanded), or null. */
function ipv6Groups(address: string): number[] | null {
  let text = address;
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text)?.[1];
  if (tail) {
    if (!isIPv4(tail)) return null;
    const [a, b, c, d] = tail.split(".").map(Number) as [number, number, number, number];
    text = `${text.slice(0, -tail.length)}${hex(a * 256 + b)}:${hex(c * 256 + d)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((g) => Number.parseInt(g, 16)));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = halves.length === 1 ? head : [...head, ...new Array<number>(fill).fill(0), ...rest];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * The address a client is counted under (before hashing): an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`, in any spelling) is
 * the plain IPv4 address, and any other IPv6 address is its /64 prefix, because one subscriber holds a whole /64 and could
 * otherwise count as 2^64 clients. IPv4, and anything that is not an address (`unknown`), is returned as given.
 */
export function normaliseClientAddress(address: string): string {
  let text = address.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  text = text.replace(/%.*$/, "");
  if (!isIPv6(text)) return isIPv4(text) ? text : address;
  const g = ipv6Groups(text);
  if (!g) return address;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  return `${g.slice(0, 4).map(hex).join(":")}::/64`;
}

/**
 * The hash a client is kept under: HMAC-SHA-256 of the scope and the address with a server-only key, hex. The key is the
 * salt: without it an address cannot be recovered from the table by trying every IPv4 address.
 */
export function clientHash(key: string, scope: string, address: string): string {
  return createHmac("sha256", key).update(`cvh:rate-limit:${scope}:${address}`).digest("hex");
}

/** The rate-limit key derived from a server-only secret (the Supabase secret key), so no new secret is needed. */
export function rateLimitKeyFromSecret(secret: string): string {
  return createHmac("sha256", secret).update("cvh:rate-limit:v1").digest("hex");
}

export interface RateLimiter {
  /**
   * Counts a request from `address` against the rule. `allowed` is false when the client already made `limit` requests in the
   * window (that request is not counted; `retryAfterSeconds` is when the oldest counted one leaves the window). The address is
   * normalised before it is hashed (see normaliseClientAddress). Throws when the database cannot be reached, or when the count
   * is not finished within `timeoutMs` (a lock held, a slow statement): the caller decides what that means.
   */
  check(rule: RateLimitRule, address: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
}

/** The longest the count waits for a lock, and the longest any one statement of it runs, so a stuck limiter cannot eat the search's 2.5 s. */
export const DEFAULT_RATE_LIMIT_TIMEOUT_MS = 600;

export function createRateLimiter(options: { db: Db; key: string; now?: () => Date; timeoutMs?: number }): RateLimiter {
  const now = options.now ?? (() => new Date());
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? DEFAULT_RATE_LIMIT_TIMEOUT_MS));
  return {
    async check(rule, address) {
      const hash = clientHash(options.key, rule.scope, normaliseClientAddress(address));
      const at = now();
      const since = new Date(at.getTime() - rule.windowMs);
      return options.db.transaction(async (tx) => {
        // A deadline for the whole count (the values are integers from this file, not input).
        await tx.execute(sql.raw(`set local lock_timeout = ${timeoutMs}`));
        await tx.execute(sql.raw(`set local statement_timeout = ${timeoutMs}`));
        // One request at a time per client, so two parallel requests cannot both see the last free place.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${rule.scope}:${hash}`}, ${RATE_LIMIT_LOCK_SEED}))`);
        const [row] = await tx
          .select({ n: count(), oldest: min(rateLimit.at) })
          .from(rateLimit)
          .where(and(eq(rateLimit.scope, rule.scope), eq(rateLimit.clientHash, hash), gt(rateLimit.at, since)));
        if ((row?.n ?? 0) >= rule.limit) {
          const free = row?.oldest ? new Date(row.oldest).getTime() + rule.windowMs - at.getTime() : rule.windowMs;
          return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(free / 1000)) };
        }
        await tx.insert(rateLimit).values({ scope: rule.scope, clientHash: hash, at });
        // Hashes older than 24 hours are deleted as requests come (nothing else needs to run).
        await tx.delete(rateLimit).where(lt(rateLimit.at, new Date(at.getTime() - RATE_LIMIT_RETENTION_MS)));
        return { allowed: true };
      });
    },
  };
}
