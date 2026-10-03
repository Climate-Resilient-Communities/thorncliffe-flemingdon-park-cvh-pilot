// The bearer secret of the job routes that pg_cron calls (AD-15: "job routes accept the current and previous secret during
// rotation"). A job route does work no visitor may trigger, so it runs only for a request that carries
// `Authorization: Bearer <JOB_SECRET>` (or JOB_SECRET_PREVIOUS while a rotation is under way). Where no usable secret is set the
// route answers 503 and does nothing: it never runs unauthenticated, so a missing variable can never leave a job open.
import { createHash, timingSafeEqual } from "node:crypto";
import type { Env } from "@/platform/config/env";

const NO_STORE = { "Cache-Control": "no-store" };

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * null when the request may run the job; otherwise the response to return (503 with no secret configured, 401 for a missing or wrong
 * one). The comparison is constant-time (a digest of each secret against a digest of what was sent), and every accepted secret
 * is compared whichever matches first, so the time taken says nothing about the secret.
 */
export function checkJobSecret(request: Request, env: Pick<Env, "jobSecrets">): Response | null {
  if (env.jobSecrets.length === 0) {
    return Response.json({ error: { code: "jobs_not_configured" } }, { status: 503, headers: NO_STORE });
  }
  const presented = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  const sent = digest(presented ?? "");
  const comparisons = env.jobSecrets.map((secret) => timingSafeEqual(digest(secret), sent));
  if (presented !== undefined && comparisons.some(Boolean)) return null;
  return Response.json({ error: { code: "unauthorized" } }, { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": "Bearer" } });
}
