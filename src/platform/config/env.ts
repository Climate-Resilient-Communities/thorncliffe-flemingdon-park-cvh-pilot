import { z } from "zod";
import { PRODUCTION_HOST } from "./hosts";

/**
 * Environment schema (AD-15), checked at boot by instrumentation.ts and on first use by getEnv().
 * Platform code: it must not import src/modules.
 *
 * Variable             Scope    Required                 Kind
 * VERCEL_ENV           server   set by Vercel            unset means local development
 * SMS_MODE             server   always                   live (production only) | log (elsewhere)
 * PUBLIC_BASE_URL      server   always                   public; https (http://localhost in development)
 * DATABASE_URL         server   production, preview      secret
 * SUPABASE_SECRET_KEY  server   production, preview      secret
 * NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *                      browser  production, preview      public
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID
 *                      server   optional; production only (start-up fails if set elsewhere); secret
 */

export type AppEnvironment = "production" | "preview" | "development";

export const TWILIO_VARIABLES = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
] as const;

// Vercel and .env files leave unset variables as empty strings.
const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
);

const rawSchema = z.object({
  VERCEL_ENV: optionalText,
  SMS_MODE: optionalText,
  PUBLIC_BASE_URL: optionalText,
  DATABASE_URL: optionalText,
  SUPABASE_SECRET_KEY: optionalText,
  NEXT_PUBLIC_SUPABASE_URL: optionalText,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalText,
  TWILIO_ACCOUNT_SID: optionalText,
  TWILIO_AUTH_TOKEN: optionalText,
  TWILIO_MESSAGING_SERVICE_SID: optionalText,
});

export interface Env {
  environment: AppEnvironment;
  smsMode: "live" | "log";
  /** Normalised origin, no trailing slash. */
  publicBaseUrl: string;
  databaseUrl?: string;
  supabaseSecretKey?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  twilio?: { accountSid: string; authToken: string; messagingServiceSid?: string };
}

export class EnvError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      `Refusing to start: unsafe or incomplete environment settings:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.name = "EnvError";
    this.problems = problems;
  }
}

function resolveEnvironment(vercelEnv: string | undefined, problems: string[]): AppEnvironment {
  if (vercelEnv === undefined) return "development";
  if (vercelEnv === "production" || vercelEnv === "preview" || vercelEnv === "development") {
    return vercelEnv;
  }
  problems.push(`VERCEL_ENV: must be production, preview or development (got "${vercelEnv}")`);
  // Treat an unknown environment as the strictest non-production one.
  return "preview";
}

function checkSmsMode(environment: AppEnvironment, smsMode: string | undefined, problems: string[]) {
  const expected = environment === "production" ? "live" : "log";
  if (smsMode === undefined) {
    problems.push(`SMS_MODE: required; must be "${expected}" in ${environment}`);
  } else if (smsMode !== expected) {
    problems.push(
      `SMS_MODE: must be "${expected}" in ${environment}, not "${smsMode}" ` +
        `("live" is allowed only in production, "log" everywhere else)`,
    );
  }
}

function checkPublicBaseUrl(
  environment: AppEnvironment,
  value: string | undefined,
  problems: string[],
): string | undefined {
  if (value === undefined) {
    problems.push("PUBLIC_BASE_URL: required (used in alert links, share links, texts and webhook checks)");
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push(`PUBLIC_BASE_URL: not a valid absolute URL ("${value}")`);
    return undefined;
  }
  const localDev = environment === "development" && url.protocol === "http:" && url.hostname === "localhost";
  if (url.protocol !== "https:" && !localDev) {
    problems.push(
      `PUBLIC_BASE_URL: must use https (http://localhost is allowed only in local development), got "${value}"`,
    );
  }
  if (url.username || url.password) {
    problems.push("PUBLIC_BASE_URL: must not contain credentials");
  }
  const onProductionHost = url.hostname.toLowerCase() === PRODUCTION_HOST;
  if (environment === "production" && !onProductionHost) {
    problems.push(
      `PUBLIC_BASE_URL: in production the host must be ${PRODUCTION_HOST} (src/platform/config/hosts.ts), got "${url.hostname}"`,
    );
  }
  if (environment !== "production" && onProductionHost) {
    problems.push(`PUBLIC_BASE_URL: ${environment} must not use the production host ${PRODUCTION_HOST}`);
  }
  return url.origin;
}

/** Validates a raw variable map. Throws EnvError listing every rule that failed. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const raw = rawSchema.parse(source);
  const problems: string[] = [];

  const environment = resolveEnvironment(raw.VERCEL_ENV, problems);
  checkSmsMode(environment, raw.SMS_MODE, problems);
  const publicBaseUrl = checkPublicBaseUrl(environment, raw.PUBLIC_BASE_URL, problems);

  if (environment !== "production") {
    const present = TWILIO_VARIABLES.filter((name) => raw[name] !== undefined);
    if (present.length > 0) {
      problems.push(`${present.join(", ")}: Twilio credentials are only allowed in production`);
    }
  }

  if (environment !== "development") {
    for (const name of [
      "DATABASE_URL",
      "SUPABASE_SECRET_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ] as const) {
      if (raw[name] === undefined) problems.push(`${name}: required in ${environment}`);
    }
  }

  if (problems.length > 0) throw new EnvError(problems);

  return {
    environment,
    smsMode: raw.SMS_MODE as "live" | "log",
    publicBaseUrl: publicBaseUrl as string,
    databaseUrl: raw.DATABASE_URL,
    supabaseSecretKey: raw.SUPABASE_SECRET_KEY,
    supabaseUrl: raw.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    twilio:
      raw.TWILIO_ACCOUNT_SID && raw.TWILIO_AUTH_TOKEN
        ? {
            accountSid: raw.TWILIO_ACCOUNT_SID,
            authToken: raw.TWILIO_AUTH_TOKEN,
            messagingServiceSid: raw.TWILIO_MESSAGING_SERVICE_SID,
          }
        : undefined,
  };
}

let cached: Env | undefined;

/** Validated environment, read once on first use. Throws EnvError (and logs it) when unsafe. */
export function getEnv(): Env {
  if (cached) return cached;
  try {
    cached = parseEnv(process.env);
  } catch (error) {
    if (error instanceof EnvError) console.error(error.message);
    throw error;
  }
  return cached;
}

/** Test seam: forget the cached environment. */
export function resetEnvCache(): void {
  cached = undefined;
}
