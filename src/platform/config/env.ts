import { z } from "zod";
import { PRODUCTION_HOST } from "./hosts";

/**
 * Environment schema (AD-15), checked at boot by instrumentation.ts and on first use by getEnv().
 * Platform code: it must not import src/modules. Messages name variables and rules, never values
 * that could be secret.
 *
 * Variable             Scope    Required                 Kind
 * VERCEL_ENV           server   set by Vercel            unset (and VERCEL unset) means local development
 * VERCEL_URL           server   set by Vercel            preview only: PUBLIC_BASE_URL defaults to https://${VERCEL_URL}
 * SMS_MODE             server   always                   live (production only) | log (elsewhere)
 * PUBLIC_BASE_URL      server   always (preview: or VERCEL_URL)
 *                                                        public; https origin, no port or path (http://localhost in development)
 * DATABASE_URL         server   production, preview      secret
 * SUPABASE_SECRET_KEY  server   production, preview      secret
 * NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *                      browser  production, preview      public; no NEXT_PUBLIC_ variable may hold a Supabase secret key
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID (and any other TWILIO_ variable)
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
  VERCEL: optionalText,
  VERCEL_ENV: optionalText,
  VERCEL_URL: optionalText,
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

type Raw = z.infer<typeof rawSchema>;

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

/** Quotes a value only when it is a short plain word (an enum such as SMS_MODE), so a secret is never printed. */
function shown(value: string): string {
  return /^\s*[A-Za-z]{1,16}\s*$/.test(value) ? JSON.stringify(value) : "a value that is not shown";
}

function resolveEnvironment(raw: Raw, problems: string[]): AppEnvironment {
  const vercelEnv = raw.VERCEL_ENV;
  if (vercelEnv === undefined) {
    if (raw.VERCEL === undefined) return "development";
    problems.push("VERCEL_ENV: missing on Vercel (VERCEL is set); expose Vercel's system environment variables");
    return "preview";
  }
  if (vercelEnv === "production" || vercelEnv === "preview" || vercelEnv === "development") {
    return vercelEnv;
  }
  problems.push(`VERCEL_ENV: must be production, preview or development (got ${shown(vercelEnv)})`);
  // Treat an unknown environment as the strictest non-production one.
  return "preview";
}

function checkSmsMode(environment: AppEnvironment, smsMode: string | undefined, problems: string[]) {
  const expected = environment === "production" ? "live" : "log";
  if (smsMode === undefined) {
    problems.push(`SMS_MODE: required; must be "${expected}" in ${environment}`);
  } else if (smsMode !== expected) {
    problems.push(
      `SMS_MODE: must be "${expected}" in ${environment}, not ${shown(smsMode)} ` +
        `("live" is allowed only in production, "log" everywhere else; exact lower case, no spaces)`,
    );
  }
}

/** Host as DNS resolves it: lower case (URL does that) and without the root's trailing dot. */
const dnsHost = (hostname: string) => hostname.replace(/\.+$/, "");

function checkPublicBaseUrl(environment: AppEnvironment, raw: Raw, problems: string[]): string | undefined {
  let value = raw.PUBLIC_BASE_URL;
  let name = "PUBLIC_BASE_URL";
  if (value === undefined && environment === "preview" && raw.VERCEL_URL !== undefined) {
    value = `https://${raw.VERCEL_URL.trim()}`;
    name = "PUBLIC_BASE_URL (from VERCEL_URL)";
  }
  if (value === undefined) {
    problems.push(
      "PUBLIC_BASE_URL: required (used in alert links, share links, texts and webhook checks)" +
        (environment === "preview" ? "; in preview it defaults to https://${VERCEL_URL}, which is also unset" : ""),
    );
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push(`${name}: not a valid absolute URL`);
    return undefined;
  }
  if (url.username || url.password) {
    // Nothing else is reported: any other message could carry the credentials' context.
    problems.push(`${name}: must not contain credentials`);
    return undefined;
  }
  const localDev =
    environment === "development" && url.protocol === "http:" && url.hostname === "localhost";
  if (url.protocol !== "https:" && !localDev) {
    problems.push(
      `${name}: must use https (http://localhost is allowed only in local development)`,
    );
    return undefined;
  }
  if (url.port !== "" && !localDev) {
    problems.push(`${name}: must not include a port`);
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    problems.push(`${name}: must be an origin only (no path, query or fragment)`);
  }
  const host = dnsHost(url.hostname);
  if (environment === "production" && url.hostname !== PRODUCTION_HOST) {
    problems.push(
      `${name}: in production the host must be ${PRODUCTION_HOST} (src/platform/config/hosts.ts), got ${url.hostname}`,
    );
  }
  if (environment !== "production" && host === PRODUCTION_HOST) {
    problems.push(`${name}: ${environment} must not use the production host ${PRODUCTION_HOST}`);
  }
  return url.origin;
}

/** True when a value is a Supabase secret key: an sb_secret_ key or a legacy service_role JWT. */
function isSupabaseSecretKey(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("sb_secret_")) return true;
  const parts = trimmed.split(".");
  if (parts.length !== 3) return false;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return typeof payload === "object" && payload !== null && (payload as { role?: unknown }).role === "service_role";
  } catch {
    return false;
  }
}

/** Validates a raw variable map. Throws EnvError listing every rule that failed. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const raw = rawSchema.parse(source);
  const problems: string[] = [];

  const environment = resolveEnvironment(raw, problems);
  checkSmsMode(environment, raw.SMS_MODE, problems);
  const publicBaseUrl = checkPublicBaseUrl(environment, raw, problems);

  if (environment !== "production") {
    const present = Object.keys(source)
      .filter((name) => name.startsWith("TWILIO_") && (source[name] ?? "").trim() !== "")
      .sort();
    if (present.length > 0) {
      problems.push(`${present.join(", ")}: Twilio credentials are only allowed in production`);
    }
  }

  for (const name of Object.keys(source).sort()) {
    const value = source[name];
    if (name.startsWith("NEXT_PUBLIC_") && value !== undefined && isSupabaseSecretKey(value)) {
      problems.push(`${name}: holds a Supabase secret key; NEXT_PUBLIC_ variables are sent to browsers`);
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

/**
 * Start-up check (Node.js runtime only): validates the environment and, when it is unsafe, exits
 * the process after getEnv has logged the failed rules, so the server never serves requests.
 */
export function checkEnvAtStartup(exit: (code: number) => never = (code) => process.exit(code)): void {
  try {
    getEnv();
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    exit(1);
  }
}
