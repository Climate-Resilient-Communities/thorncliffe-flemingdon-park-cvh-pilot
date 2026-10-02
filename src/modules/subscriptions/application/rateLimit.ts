// The per-client rate limiter of the public endpoints (S03.04, AD-22): "at most `limit` requests per `windowMs` from one
// client", kept in Postgres against a keyed hash of the client's address, never the address (AD-13). Search uses it first
// (30 questions per 10 minutes); sign-up (E07) will use it with its own scope. Each allowed request is one `rate_limit` row,
// deleted after 24 hours; a refused request is not counted, so a client that waits out the window is served again.
import { createHmac } from "node:crypto";
import { and, count, eq, gt, lt, sql } from "drizzle-orm";
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
   * window (that request is not counted). Throws when the database cannot be reached: the caller decides what that means.
   */
  check(rule: RateLimitRule, address: string): Promise<{ allowed: boolean }>;
}

export function createRateLimiter(options: { db: Db; key: string; now?: () => Date }): RateLimiter {
  const now = options.now ?? (() => new Date());
  return {
    async check(rule, address) {
      const hash = clientHash(options.key, rule.scope, address);
      const at = now();
      const since = new Date(at.getTime() - rule.windowMs);
      return options.db.transaction(async (tx) => {
        // One request at a time per client, so two parallel requests cannot both see the last free place.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${rule.scope}:${hash}`}, ${RATE_LIMIT_LOCK_SEED}))`);
        const [row] = await tx
          .select({ n: count() })
          .from(rateLimit)
          .where(and(eq(rateLimit.scope, rule.scope), eq(rateLimit.clientHash, hash), gt(rateLimit.at, since)));
        if ((row?.n ?? 0) >= rule.limit) return { allowed: false };
        await tx.insert(rateLimit).values({ scope: rule.scope, clientHash: hash, at });
        // Hashes older than 24 hours are deleted as requests come (nothing else needs to run).
        await tx.delete(rateLimit).where(lt(rateLimit.at, new Date(at.getTime() - RATE_LIMIT_RETENTION_MS)));
        return { allowed: true };
      });
    },
  };
}
