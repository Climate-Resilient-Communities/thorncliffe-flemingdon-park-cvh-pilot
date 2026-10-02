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
 * DATABASE_URL         server   production, preview      secret; the app's own connection: in production and preview
 *                                                        it must connect as cvh_app_login.<project-ref> (never as postgres)
 *                                                        through the transaction pooler (port 6543). Migrations are not
 *                                                        run with it: they use PRODUCTION_DATABASE_URL, as postgres on the
 *                                                        session pooler (port 5432)
 * SUPABASE_SECRET_KEY  server   production, preview      secret; Supabase Auth's Admin API (identity's adapter, built only in
 *                                                        server code and scripts/create-first-admin) and the private Storage
 *                                                        bucket of the directory release files (src/app/directoryRelease.ts,
 *                                                        S02.05), never in a NEXT_PUBLIC_ variable
 * NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *                      browser  production, preview      public; no NEXT_PUBLIC_ variable may hold a Supabase secret key.
 *                                                        The Supabase project's JWT expiry (Auth > Settings > "JWT expiry
 *                                                        limit", jwt_exp) must be 43200 seconds: staff sessions are never
 *                                                        refreshed, so the access token is the whole 12-hour session (sign-in
 *                                                        logs identity.jwt_expiry_short once per process when it is shorter)
 * STAFF_PASSWORD_PEPPER
 *                      server   optional at start-up     secret; at least 32 random bytes as hex (64+ characters, `openssl rand
 *                                                        -hex 32`) or base64 (44+ characters). Supabase Auth stores
 *                                                        hex(HMAC-SHA-256(pepper, password)), never the typed password. Not
 *                                                        required to start, so the site runs before it is set; until it is,
 *                                                        every staff sign-in, account creation, password change and re-issue
 *                                                        refuses (logged as identity.staff_passwords_not_configured). Never a
 *                                                        NEXT_PUBLIC_ variable, never printed. The same value wherever the same
 *                                                        Supabase project is used; changing it makes every password unusable
 *                                                        until each is re-issued
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID, TWILIO_FROM_NUMBER (and any other TWILIO_ variable)
 *                      server   optional; production only (start-up fails if set elsewhere); secret.
 *                                                        TWILIO_FROM_NUMBER is the verified toll-free number (E.164) the S01.15
 *                                                        spike sends from; the page that sends the test text needs the account SID,
 *                                                        auth token and that number, and without them shows that Twilio is not set up
 * SMS_TEST_ALLOWLIST   server   optional; production only (start-up fails if set elsewhere)
 *                                                        the E.164 numbers (comma-separated) the S01.15 test text may go to, set in
 *                                                        production's Vercel variables, never in the repository. Empty or unset:
 *                                                        no number is approved and nothing can be sent. Like the password pepper, a
 *                                                        malformed entry (or a malformed TWILIO_FROM_NUMBER) never stops the server:
 *                                                        smsTestProblem names the rule (never the value), no number is approved and
 *                                                        the page shows that texts are not set up. Set outside production it does
 *                                                        fail start-up: that is a secret-placement rule
 * COHERE_API_KEY (and any other COHERE_ variable)
 *                      server   optional; production only (start-up fails if set elsewhere); secret. Cohere's API key,
 *                                                        the one key of the pilot (AD-15), used by the directory publish job
 *                                                        to embed each provider's search text (S03.02) and later by search
 *                                                        and translation. Never absent by accident: a set-but-blank value
 *                                                        fails start-up in every environment (unset the variable instead).
 *                                                        Unset, a release is published without search data only while no
 *                                                        release has had any; once the current release has search data, a
 *                                                        publish without the key is refused (search_not_configured). Never a
 *                                                        NEXT_PUBLIC_ variable (nor a variable whose name contains COHERE,
 *                                                        nor one holding the key), never printed. Tests and ci:local never
 *                                                        use it: the embedding model is behind a port with a fake
 * SEARCH_EMBED_MODEL   server   optional                 the embedding model a release's search data is made with and every
 *                                                        question is embedded with; default embed-v4.0 (AD-11; a config value
 *                                                        the test set can change)
 * SEARCH_THRESHOLD     server   optional                 the similarity (0 to 1) below which a question has no clear match,
 *                                                        recorded on each release. PROVISIONAL default 0.3: S03.07 chooses it
 *                                                        from the tuning subset; changing it means publishing a new release,
 *                                                        which copies the existing vectors
 * SEARCH_EMERGENCY_CATEGORIES
 *                      server   optional                 comma-separated English names of the categories whose results put
 *                                                        the 911 block first, recorded on each release; default
 *                                                        "Support & Emergency Services". A name the catalogue does not have
 *                                                        refuses the publish (search_config_invalid)
 * EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH, EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH
 *                      server   optional                 the publish allowance (AD-15): how many embedding calls and input
 *                                                        tokens the directory publish may use in a calendar month
 *                                                        (America/Toronto), counted from spend_event rows with purpose
 *                                                        `publish` only, while Cohere's price is unknown. Questions and
 *                                                        test-set runs have allowances of their own. The publish job refuses
 *                                                        to embed past it. Defaults 500 calls and 2,000,000 tokens
 * CVH_FAKE_IDENTITY_FILE
 *                      server   optional; local development only (start-up fails on Vercel): the staff surface signs
 *                                                        in against the in-memory identity fake kept in this file instead of
 *                                                        Supabase Auth (the end-to-end tests); never a real account
 * CVH_FAKE_BUILDINGS_FILE
 *                      server   optional; local development only (start-up fails on Vercel): the resident building
 *                                                        page reads its buildings from this JSON file instead of the
 *                                                        database (the resident page tests and their screenshots)
 * CVH_FAKE_DIRECTORY_DIR
 *                      server   optional; local development only (start-up fails on Vercel): the directory release files
 *                                                        are kept in this folder instead of the private Supabase Storage
 *                                                        bucket (the end-to-end tests); an absolute path (a relative one would
 *                                                        name a different folder for each process that reads it)
 */

/** A POSIX path from the root, or a Windows drive path. */
const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/])/;

export type AppEnvironment = "production" | "preview" | "development";

export const TWILIO_VARIABLES = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_FROM_NUMBER",
] as const;

/** An E.164 number: "+", a non-zero country code digit, up to 14 more digits (at least 8 digits in all). */
export const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;

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
  TWILIO_FROM_NUMBER: optionalText,
  SMS_TEST_ALLOWLIST: optionalText,
  CVH_FAKE_IDENTITY_FILE: optionalText,
  CVH_FAKE_BUILDINGS_FILE: optionalText,
  CVH_FAKE_DIRECTORY_DIR: optionalText,
  STAFF_PASSWORD_PEPPER: optionalText,
  COHERE_API_KEY: optionalText,
  SEARCH_EMBED_MODEL: optionalText,
  SEARCH_THRESHOLD: optionalText,
  SEARCH_EMERGENCY_CATEGORIES: optionalText,
  EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH: optionalText,
  EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH: optionalText,
});

type Raw = z.infer<typeof rawSchema>;

/** The settings of search that a release records or the publish job obeys (S03.02). */
export interface SearchSettings {
  /** The Cohere embedding model id. */
  embedModel: string;
  /** Similarity below which a question has no clear match (provisional until S03.07). */
  threshold: number;
  /** English names of the categories that put the 911 block first. */
  emergencyCategories: string[];
  /** Embedding usage the calendar month may reach: calls and input tokens. */
  allowance: { callsPerMonth: number; tokensPerMonth: number };
}

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  embedModel: "embed-v4.0",
  threshold: 0.3,
  emergencyCategories: ["Support & Emergency Services"],
  allowance: { callsPerMonth: 500, tokensPerMonth: 2_000_000 },
};

const EMBED_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface Env {
  environment: AppEnvironment;
  smsMode: "live" | "log";
  /** Normalised origin, no trailing slash. */
  publicBaseUrl: string;
  databaseUrl?: string;
  supabaseSecretKey?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  twilio?: { accountSid: string; authToken: string; messagingServiceSid?: string; fromNumber?: string };
  /** The numbers the S01.15 test text may go to (E.164, production only); empty when none is approved. */
  smsTestAllowlist: string[];
  /** Why the test text is not set up although it was configured (names the rule, never a value); undefined when nothing is wrong. */
  smsTestProblem?: string;
  /** Local development only: the identity fake's state file (end-to-end tests). */
  fakeIdentityFile?: string;
  /** Local development only: sample buildings for the resident page tests, read instead of the database. */
  fakeBuildingsFile?: string;
  /** Local development only: the folder the directory release files are kept in (end-to-end tests). */
  fakeDirectoryDir?: string;
  /** Cohere's API key: set only in production. The publish job embeds search data when it is set, and publishes without when not. */
  cohereApiKey?: string;
  /** The search settings, with their defaults; they apply only where a key is configured. */
  search: SearchSettings;
  /** The password pepper, only when it is set and strong enough; otherwise staffPasswordPepperProblem says why not. */
  staffPasswordPepper?: string;
  /** Why staff passwords are not configured (names the rule, never the value); undefined when they are. */
  staffPasswordPepperProblem?: string;
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

/**
 * Where this runs, from VERCEL and VERCEL_ENV. `fallback` is the environment to assume, with a problem to report,
 * when Vercel's variables are missing or unknown: parseEnv assumes the strictest non-production one ("preview") and
 * fails the boot; a caller that must fail closed (failClosedEnvironment) assumes "production".
 */
function detectEnvironment(
  raw: Pick<Raw, "VERCEL" | "VERCEL_ENV">,
  fallback: AppEnvironment,
): { environment: AppEnvironment; problem?: string } {
  const vercelEnv = raw.VERCEL_ENV;
  if (vercelEnv === undefined) {
    if (raw.VERCEL === undefined) return { environment: "development" };
    return {
      environment: fallback,
      problem: "VERCEL_ENV: missing on Vercel (VERCEL is set); expose Vercel's system environment variables",
    };
  }
  if (vercelEnv === "production" || vercelEnv === "preview" || vercelEnv === "development") {
    return { environment: vercelEnv };
  }
  return {
    environment: fallback,
    problem: `VERCEL_ENV: must be production, preview or development (got ${shown(vercelEnv)})`,
  };
}

function resolveEnvironment(raw: Raw, problems: string[]): AppEnvironment {
  const { environment, problem } = detectEnvironment(raw, "preview");
  if (problem) problems.push(problem);
  return environment;
}

/**
 * The environment for a caller that must fail closed (the terms page: only a known preview or local development may
 * show unpublished text). Same detection as parseEnv, but a missing or unknown VERCEL_ENV on Vercel counts as
 * production, and nothing else is validated or thrown: it reads only VERCEL and VERCEL_ENV.
 */
export function failClosedEnvironment(source: Record<string, string | undefined> = process.env): AppEnvironment {
  return detectEnvironment(rawSchema.pick({ VERCEL: true, VERCEL_ENV: true }).parse(source), "production").environment;
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

const APP_DB_USER = /^cvh_app_login(?:\.[a-z0-9_-]+)?$/;
const TRANSACTION_POOLER_PORT = "6543";

/**
 * In production and preview the app connects as its own role (cvh_app_login, or
 * cvh_app_login.<project-ref> through Supabase's pooler) on the transaction pooler, never as
 * the owner role. The messages name the rule only: not the URL, user name or password.
 */
function checkDatabaseUrl(value: string | undefined, problems: string[]) {
  if (value === undefined) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push("DATABASE_URL: not a valid postgres:// URL");
    return;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    problems.push("DATABASE_URL: must be a postgres:// URL");
    return;
  }
  let user: string;
  try {
    user = decodeURIComponent(url.username);
  } catch {
    user = "";
  }
  if (!APP_DB_USER.test(user)) {
    problems.push(
      "DATABASE_URL: must connect as the app's role cvh_app_login or cvh_app_login.<project-ref>, " +
        "never as the owner role or another role (the user name is not shown)",
    );
  }
  if (url.port !== TRANSACTION_POOLER_PORT) {
    problems.push(`DATABASE_URL: must use the transaction pooler, port ${TRANSACTION_POOLER_PORT}`);
  }
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

export const STAFF_PASSWORD_PEPPER_MIN_BYTES = 32;

/**
 * The password pepper's rule: at least 32 bytes of key material written as hex or base64, and not
 * an obviously repeated pattern. Returns the problem, or undefined when the value is usable. Never
 * fails start-up (see the table above): the identity operations refuse instead.
 */
export function staffPasswordPepperProblem(value: string | undefined): string | undefined {
  if (value === undefined) return "STAFF_PASSWORD_PEPPER: not set";
  const trimmed = value.trim();
  let bytes = 0;
  if (/^[0-9a-fA-F]+$/.test(trimmed)) bytes = Math.floor(trimmed.length / 2);
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) bytes = Math.floor((trimmed.replace(/=+$/, "").length * 3) / 4);
  else return "STAFF_PASSWORD_PEPPER: must be hex or base64 (for example `openssl rand -hex 32`)";
  if (bytes < STAFF_PASSWORD_PEPPER_MIN_BYTES || new Set(trimmed).size < 10) {
    return `STAFF_PASSWORD_PEPPER: must be at least ${STAFF_PASSWORD_PEPPER_MIN_BYTES} random bytes (for example \`openssl rand -hex 32\`)`;
  }
  return undefined;
}

export const SMS_TEST_ALLOWLIST_PROBLEM =
  "SMS_TEST_ALLOWLIST: every entry must be an E.164 number such as +18885550100, separated by commas (the entries are not shown)";
export const TWILIO_FROM_NUMBER_PROBLEM = "TWILIO_FROM_NUMBER: must be an E.164 number such as +18885550100 (the value is not shown)";

/**
 * SMS_TEST_ALLOWLIST (S01.15): comma-separated E.164 numbers, production only. Messages name the rule,
 * never an entry. Outside production the variable must be absent (numbers never go into a preview): that is a
 * secret-placement rule and stays fatal. A malformed entry is a typo in a spike variable and must not take the
 * whole site down at every cold start (the staffPasswordPepperProblem pattern): it returns the problem and an
 * empty allowlist, so nothing can be sent and the page says texts are not set up.
 */
function parseSmsTestAllowlist(value: string | undefined, environment: AppEnvironment, problems: string[]): { allowlist: string[]; problem?: string } {
  if (value === undefined) return { allowlist: [] };
  if (environment !== "production") {
    problems.push("SMS_TEST_ALLOWLIST: only allowed in production (the approved numbers are set in production's variables only)");
    return { allowlist: [] };
  }
  const entries = value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  if (entries.some((entry) => !E164_PATTERN.test(entry))) return { allowlist: [], problem: SMS_TEST_ALLOWLIST_PROBLEM };
  return { allowlist: [...new Set(entries)] };
}

/** A whole number of at least 1 from a variable, or the default; a bad value is a problem that names the variable, never the value. */
function positiveInteger(name: string, value: string | undefined, fallback: number, problems: string[]): number {
  if (value === undefined) return fallback;
  if (!/^[0-9]{1,12}$/.test(value.trim()) || Number(value) < 1) {
    problems.push(`${name}: must be a whole number of at least 1`);
    return fallback;
  }
  return Number(value);
}

function parseSearchSettings(raw: Raw, problems: string[]): SearchSettings {
  const defaults = DEFAULT_SEARCH_SETTINGS;
  const embedModel = raw.SEARCH_EMBED_MODEL?.trim() ?? defaults.embedModel;
  if (!EMBED_MODEL_ID.test(embedModel)) problems.push("SEARCH_EMBED_MODEL: must be a model id such as embed-v4.0 (letters, digits, dots, hyphens, underscores)");
  let threshold = defaults.threshold;
  if (raw.SEARCH_THRESHOLD !== undefined) {
    const text = raw.SEARCH_THRESHOLD.trim();
    const value = Number(text);
    if (!/^[0-9]*\.?[0-9]+$/.test(text) || !(value >= 0 && value <= 1)) problems.push("SEARCH_THRESHOLD: must be a number from 0 to 1, such as 0.3");
    else threshold = value;
  }
  let emergencyCategories = defaults.emergencyCategories;
  if (raw.SEARCH_EMERGENCY_CATEGORIES !== undefined) {
    const names = [...new Set(raw.SEARCH_EMERGENCY_CATEGORIES.split(",").map((name) => name.trim()).filter((name) => name !== ""))];
    if (names.length === 0 || names.some((name) => name.length > 100)) problems.push("SEARCH_EMERGENCY_CATEGORIES: must list at least one category name, separated by commas (each at most 100 characters)");
    else emergencyCategories = names;
  }
  return {
    embedModel,
    threshold,
    emergencyCategories,
    allowance: {
      callsPerMonth: positiveInteger("EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH", raw.EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH, defaults.allowance.callsPerMonth, problems),
      tokensPerMonth: positiveInteger("EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH", raw.EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH, defaults.allowance.tokensPerMonth, problems),
    },
  };
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

  if (environment !== "production") {
    const present = Object.keys(source)
      .filter((name) => name.startsWith("COHERE_") && (source[name] ?? "").trim() !== "")
      .sort();
    if (present.length > 0) {
      problems.push(`${present.join(", ")}: Cohere credentials are only allowed in production`);
    }
  }
  // A key that is set but blank is a deployment mistake that would silently switch search off: the variable must be unset or hold the key.
  if (source.COHERE_API_KEY !== undefined && source.COHERE_API_KEY.trim() === "") {
    problems.push("COHERE_API_KEY: set but blank; unset it or give it the key");
  }
  const search = parseSearchSettings(raw, problems);

  const allowlist = parseSmsTestAllowlist(raw.SMS_TEST_ALLOWLIST, environment, problems);
  const smsTestAllowlist = allowlist.problem === undefined ? allowlist.allowlist : [];
  const fromNumber = raw.TWILIO_FROM_NUMBER?.trim();
  const fromNumberProblem = environment === "production" && fromNumber !== undefined && !E164_PATTERN.test(fromNumber);
  const smsTestProblem = [allowlist.problem, fromNumberProblem ? TWILIO_FROM_NUMBER_PROBLEM : undefined].filter((p) => p !== undefined).join("; ") || undefined;

  const onVercel = raw.VERCEL !== undefined || raw.VERCEL_ENV !== undefined;
  if ((environment !== "development" || onVercel) && raw.CVH_FAKE_IDENTITY_FILE !== undefined) {
    problems.push("CVH_FAKE_IDENTITY_FILE: the identity fake is only allowed in local development, never on Vercel");
  }

  if ((environment !== "development" || onVercel) && raw.CVH_FAKE_BUILDINGS_FILE !== undefined) {
    problems.push("CVH_FAKE_BUILDINGS_FILE: the buildings fake is only allowed in local development, never on Vercel");
  }
  if ((environment !== "development" || onVercel) && raw.CVH_FAKE_DIRECTORY_DIR !== undefined) {
    problems.push("CVH_FAKE_DIRECTORY_DIR: the local directory store is only allowed in local development, never on Vercel");
  } else if (raw.CVH_FAKE_DIRECTORY_DIR !== undefined && !ABSOLUTE_PATH.test(raw.CVH_FAKE_DIRECTORY_DIR)) {
    problems.push("CVH_FAKE_DIRECTORY_DIR: must be an absolute path");
  }

  const pepper = raw.STAFF_PASSWORD_PEPPER?.trim();
  const cohereKey = raw.COHERE_API_KEY?.trim();
  for (const name of Object.keys(source).sort()) {
    const value = source[name];
    if (name.startsWith("NEXT_PUBLIC_") && value !== undefined && value.trim() !== "") {
      if (name.toUpperCase().includes("COHERE") || (cohereKey !== undefined && value.trim() === cohereKey)) {
        problems.push(`${name}: holds or names the Cohere key; NEXT_PUBLIC_ variables are sent to browsers`);
      }
    }
    if (name.startsWith("NEXT_PUBLIC_") && value !== undefined && isSupabaseSecretKey(value)) {
      problems.push(`${name}: holds a Supabase secret key; NEXT_PUBLIC_ variables are sent to browsers`);
    }
    if (name.startsWith("NEXT_PUBLIC_") && value !== undefined && value.trim() !== "") {
      if (name.includes("PEPPER") || (pepper !== undefined && value.trim() === pepper)) {
        problems.push(`${name}: holds the staff password pepper; NEXT_PUBLIC_ variables are sent to browsers`);
      }
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
    checkDatabaseUrl(raw.DATABASE_URL, problems);
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
            fromNumber: fromNumberProblem ? undefined : fromNumber,
          }
        : undefined,
    smsTestAllowlist,
    smsTestProblem,
    cohereApiKey: raw.COHERE_API_KEY?.trim(),
    search,
    fakeIdentityFile: raw.CVH_FAKE_IDENTITY_FILE,
    fakeBuildingsFile: raw.CVH_FAKE_BUILDINGS_FILE,
    fakeDirectoryDir: raw.CVH_FAKE_DIRECTORY_DIR,
    ...pepperSettings(raw.STAFF_PASSWORD_PEPPER),
  };
}

function pepperSettings(value: string | undefined): Pick<Env, "staffPasswordPepper" | "staffPasswordPepperProblem"> {
  const problem = staffPasswordPepperProblem(value);
  return problem === undefined ? { staffPasswordPepper: (value as string).trim() } : { staffPasswordPepperProblem: problem };
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
  // A misconfigured spike variable never stops the server; the rule is logged (never the value) so IT can fix it.
  if (cached.smsTestProblem !== undefined) {
    console.error(JSON.stringify({ level: "error", evt: "env.sms_test_not_configured", module: "platform", rule: cached.smsTestProblem }));
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
