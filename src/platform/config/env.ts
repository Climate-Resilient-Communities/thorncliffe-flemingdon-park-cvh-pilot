import { z } from "zod";
import { parseUntranslatedKeys } from "../../i18n/untranslated";
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
 *                                                        TWILIO_FROM_NUMBER is the verified toll-free number (E.164) residents are told
 *                                                        to text START to (R-06, S07.02); texts themselves go through the Messaging
 *                                                        Service. A malformed one never stops the server: it is dropped, the line on R-06
 *                                                        names no number, and the rule is logged (twilioFromNumberProblem; never the value)
 *                                                        TWILIO_AUTH_TOKEN also checks the signature of Twilio's status callbacks
 *                                                        (/api/twilio/status, S06.04): without it that route answers 503 and does nothing
 * JOB_SECRET, JOB_SECRET_PREVIOUS
 *                      server   optional at start-up     secret; at least 32 random bytes as hex or base64, like the pepper
 *                                                        (`openssl rand -hex 32`). The bearer secret of the job routes that
 *                                                        pg_cron calls (/api/jobs/dispatch, /api/jobs/messaging-config, /api/jobs/reconcile-spend, /api/jobs/health, /api/jobs/expire; AD-15): a
 *                                                        request without `Authorization: Bearer <secret>` is refused with 401. During
 *                                                        a rotation both are accepted (JOB_SECRET_PREVIOUS is the old one); a missing
 *                                                        or weak JOB_SECRET never stops the site, the job routes answer 503
 *                                                        (jobs_not_configured) until it is set, and nothing runs unauthenticated.
 *                                                        Set in production only (the pg_cron target and its secret in the project's
 *                                                        Vault point at production, AD-15). Never a NEXT_PUBLIC_ variable
 * SMS_SEGMENTS_PER_SECOND
 *                      server   optional                 the shared send pace (E06 "Send pace"): at most this many SMS segments a
 *                                                        second reach the provider in any one second, across every dispatcher run.
 *                                                        Default 3 (Twilio's default toll-free rate); a whole number from 1 to 100.
 *                                                        Not a TWILIO_ variable: it is not a credential and is allowed everywhere
 * SMS_PRICE_PER_SEGMENT_CENTS
 *                      server   optional                 the price of one text message segment in cents CAD: a positive number with at
 *                                                        most three decimals and no more than 100 (1.5 is a cent and a half); default
 *                                                        1.5. PROVISIONAL: IT confirms it from Twilio's price for Canadian toll-free
 *                                                        numbers. The renderer's cost estimate (S04.06) is segments x recipients x this
 *                                                        price, rounded up to whole cents, and always shown as an estimate
 * SMS_USD_TO_CAD_RATE server   optional                 the exchange rate (Canadian dollars per US dollar) a reconciliation (S06.08)
 *                                                        converts the prices Twilio reports (in US dollars) at: a positive number with
 *                                                        at most four decimals, between 0.5 and 5 (1.4 is CAD 1.40 per USD 1); default
 *                                                        1.4. PROVISIONAL: the owner confirms it. Each actual price keeps the rate it
 *                                                        was converted at and is shown labelled with it. Not a TWILIO_ variable: it is
 *                                                        not a credential and is allowed everywhere
 * SMS_TRANSACTIONAL_DAILY_CEILING
 *                      server   optional                 the daily ceiling on non-alert (`transactional`) texts, menus and prompts
 *                                                        included and texts to on-call numbers not counted (AD-22, S09.01): more
 *                                                        than this many created since midnight in Toronto raises the health job's
 *                                                        `transactional_ceiling` condition (the on-call Admins are texted once
 *                                                        that day; texts keep sending). A whole number of at least 1; default 300.
 *                                                        PROVISIONAL: the owner confirms it against the expected sign-ups a day
 * SPEND_PILOT_BUDGET_CENTS
 *                      server   optional                 the pilot's budget in whole cents CAD that the spend view (S07.08) shows spending
 *                                                        against: a whole number of at least 1; default 100000 (CAD 1,000). Not a cap:
 *                                                        the monthly cap an Admin sets on the Hub is stored in the database
 * SPEND_TOKEN_ESTIMATE_CAD_PER_MILLION
 *                      server   optional                 an estimate rate, in CAD per million tokens, for Cohere usage whose price is
 *                                                        unknown (S07.08): a positive number with at most four decimals. Unset, such
 *                                                        usage is shown as "price unknown" with its units and left out of totals; set,
 *                                                        it is shown as a labelled estimate and counted. Not a COHERE_ variable (it is
 *                                                        no credential and is allowed everywhere)
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
 * SEARCH_THRESHOLD     server   optional                 the score (0 to 1) below which a question has no clear match on the
 *                                                        ranking's hybrid route (English questions and those the translated
 *                                                        leg answered; the score is the similarity plus the keyword boost),
 *                                                        recorded on each release. PROVISIONAL default 0.27 (interim tuning,
 *                                                        2026-10-07, on a mostly machine-drafted test set; S03.08 confirms
 *                                                        it); changing it means publishing a new release, which copies the
 *                                                        existing vectors
 * SEARCH_KEYWORD_WEIGHT
 *                      server   optional                 the most (0 to 1) the keyword match (BM25 over the providers'
 *                                                        English text) adds to a similarity on the hybrid route; default
 *                                                        0.15, 0 switches the boost off. Read at search time
 * SEARCH_DIRECT_FLOOR, SEARCH_DIRECT_GAP
 *                      server   optional                 the direct route (other languages, when no translated leg
 *                                                        completed): results only when the best similarity is at least the
 *                                                        floor (0 to 1, default 0.24), and none more than the gap (0 to 1,
 *                                                        default 0.10) below it. Read at search time
 * SEARCH_EMERGENCY_THRESHOLD
 *                      server   optional                 the similarity (0 to 1) at which a provider of an emergency category
 *                                                        among the top 3 of either leg turns `emergency_first` on, even when
 *                                                        nothing is shown (owner decision 41: a fail-safe); default 0.25, and
 *                                                        at most SEARCH_THRESHOLD. Read at search time, not recorded on a release
 * SEARCH_EMERGENCY_TOP_THRESHOLD
 *                      server   optional                 the similarity (0 to 1) at which a provider of an emergency category
 *                                                        that is the best match of either leg turns `emergency_first` on;
 *                                                        default 0.14 (interim tuning, 2026-10-07). Read at search time
 * SEARCH_EMERGENCY_CATEGORIES
 *                      server   optional                 comma-separated English names of the categories whose results put
 *                                                        the 911 block first, recorded on each release; default
 *                                                        "Support & Emergency Services". A name the catalogue does not have
 *                                                        refuses the publish (search_config_invalid)
 * SEARCH_QUESTION_ROUTE
 *                      server   optional                 `search_question_route` (S03.05): the Cohere model that translates a
 *                                                        question to English for the translated-question leg of search, per
 *                                                        kind of question, as comma-separated `kind=model` pairs; a kind left
 *                                                        out keeps its default, `kind=off` switches the leg off for it, and
 *                                                        `off` alone switches it off for all. Kinds: ps, prs, ur,
 *                                                        romanized_or_mixed, ambiguous_arabic, and (translate-first) the
 *                                                        other launch languages when the question is confidently in one:
 *                                                        tl, gu, ta, el, sk, bn, hi, pa, zh, es, fr. PROVISIONAL defaults:
 *                                                        north-small-translate-09-2026 for ps, prs and ur (native-script
 *                                                        Urdu, owner decision 40),
 *                                                        command-a-translate-08-2025 for romanized_or_mixed and
 *                                                        ambiguous_arabic (the addendum's routing; confirmed at Launch
 *                                                        Readiness) and for ta and pa (translate-first, 2026-10-07
 *                                                        measurement); off for the other translate-first languages (they
 *                                                        are searched directly, with the reranker, as when a translation
 *                                                        fails). It applies only where COHERE_API_KEY is set
 * SEARCH_QUESTION_FALLBACK
 *                      server   optional                 the Cohere model the translated-question leg retries once with when
 *                                                        the routed model is past its limit (HTTP 429: quota or rate limit),
 *                                                        per kind of question, in the shape of SEARCH_QUESTION_ROUTE: comma-
 *                                                        separated `kind=model` pairs, a kind left out keeps its default,
 *                                                        `kind=off` means no retry for it, `off` alone for all. Kinds: as
 *                                                        SEARCH_QUESTION_ROUTE. PROVISIONAL defaults (owner
 *                                                        decision 45): command-a-translate-08-2025 for prs, ur,
 *                                                        romanized_or_mixed and ambiguous_arabic (for the last two it only
 *                                                        applies if their route is changed: the routed model is that model),
 *                                                        off for ps (Command A Translate turned Pashto into Dari; S03.07 decides);
 *                                                        off for the translate-first languages (ta and pa included: North
 *                                                        Small Translate's month is alert translation's).
 * SEARCH_TRANSLATE_FIRST_MONTHLY_CALLS
 *                      server   optional                 a whole number (default 600): a translate-first question (ta, pa…) is
 *                                                        translated only while its model's translate calls this calendar
 *                                                        month (America/Toronto, spend_event, every purpose, alert translation
 *                                                        included) are below it; past it the question takes the direct route
 *                                                        with the reranker. Cohere allows ~1,000 a model a month on the key,
 *                                                        so 600 leaves alert translation (S04.02: Command A Translate first
 *                                                        for fr, es, zh, el, hi) a reserve of ~400
 *                                                        Never the routed model itself
 * SEARCH_FALLBACK_MIN_BUDGET_MS
 *                      server   optional                 the least time (0 to 2200 ms, default 800) that must be left of the
 *                                                        leg's 2.2 s for the fallback to be tried: a call that cannot finish
 *                                                        would only be billed
 * SEARCH_TRANSLATE_MONTHLY_CALLS
 *                      server   optional                 `model=limit` pairs: the translation calls a model may use in a
 *                                                        calendar month (America/Toronto), as the vendor limits them, e.g.
 *                                                        north-small-translate-09-2026=1000. No default: unset, there is no
 *                                                        warning. When translate spend_event rows of a model with a limit
 *                                                        reach 80% of it, ops gets one `search.leg_failed` event
 *                                                        (`translate_quota_near`) per model per month per instance
 * SEARCH_RERANK         server   optional                 `on` (default) or `off`: whether a question in another language that
 *                                                        takes no translated leg (es, fr, zh, tl, ta, pa, bn, gu, hi, el, sk…)
 *                                                        has its 20 best providers reranked with Cohere rerank-v3.5 (interim
 *                                                        tuning, arm R2). It applies only where COHERE_API_KEY is set; on any
 *                                                        failure the question is ranked by SEARCH_DIRECT_FLOOR and _GAP
 * SEARCH_RERANK_MIN     server   optional                 the least rerank relevance (0 to 1, default 0.05) of a reranked result
 * SEARCH_RERANK_MONTHLY_CALLS
 *                      server   optional                 the rerank calls a calendar month (America/Toronto) may use, counted
 *                                                        from spend_event (kind rerank); at it the reranker is no longer called
 *                                                        that month. Default 900: Cohere allows about 1,000 a month per model
 * EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH, EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH
 *                      server   optional                 the publish allowance (AD-15): how many embedding calls and input
 *                                                        tokens the directory publish may use in a calendar month
 *                                                        (America/Toronto), counted from spend_event rows with purpose
 *                                                        `publish` only, while Cohere's price is unknown. Questions and
 *                                                        test-set runs have allowances of their own. The publish job refuses
 *                                                        to embed past it. Defaults 500 calls and 2,000,000 tokens
 * RESIDENT_ALERTS_ENABLED
 *                      server   optional                 `true` or `false`: whether the feed and the alert pages tell residents
 *                                                        about any alert (AD-17, S04.08), the launch gate. Production runs with
 *                                                        it OFF unless the variable is `true`: unset means false there. E05 is
 *                                                        released, so the code lock (RESIDENT_ALERTS_RELEASED, below) is open and
 *                                                        `true` in production starts and turns the gate on. Previews and local development
 *                                                        run with it on unless it is set to false. A value that is neither fails
 *                                                        start-up (a typo must not switch the gate)
 * MAP_TILE_*           build    optional                 the resident map's tile provider, its credit and whether and how long a
 *                                                        phone may keep viewed tiles: read by src/platform/config/mapTiles.ts
 *                                                        when the map pages are built, not here (S02.07)
 * CVH_FAKE_IDENTITY_FILE
 *                      server   optional; local development only (start-up fails on Vercel): the staff surface signs
 *                                                        in against the in-memory identity fake kept in this file instead of
 *                                                        Supabase Auth (the end-to-end tests); never a real account
 * CVH_FAKE_BUILDINGS_FILE
 *                      server   optional; local development only (start-up fails on Vercel): the resident building
 *                                                        page reads its buildings from this JSON file instead of the
 *                                                        database (the resident page tests and their screenshots)
 * CVH_FAKE_FEED_FILE   server   optional; local development only (start-up fails on Vercel): the feed and the alert pages read their
 *                                                        threads from this JSON file instead of the database (the resident page
 *                                                        tests and their screenshots); never a real alert
 * CVH_FAKE_GUIDES_FILE
 *                      server   optional; local development only (start-up fails on Vercel): the resident guide and
 *                                                        essential-numbers pages read their guides and numbers from this JSON
 *                                                        file instead of the database (the resident page tests and their
 *                                                        screenshots)
 * CVH_FAKE_DIRECTORY_DIR
 *                      server   optional; local development only (start-up fails on Vercel): the directory release files
 *                                                        are kept in this folder instead of the private Supabase Storage
 *                                                        bucket (the end-to-end tests); an absolute path (a relative one would
 *                                                        name a different folder for each process that reads it)
 * CVH_FAKE_TRANSLATOR  server   optional; local development only (start-up fails on Vercel): `sample` translates an alert
 *                                                        with a fake model that answers every language with a fixed passing
 *                                                        sample text, so a submit can be run end to end with no Cohere key (the
 *                                                        end-to-end tests); never a real translation
 * CVH_FAKE_UNTRANSLATED_KEYS
 *                      server   optional; local development only (start-up fails on Vercel): comma-separated catalog
 *                                                        keys (R31.title, ...) that every language but English shows as
 *                                                        English behind "[EN] " on the pages rendered on request, so the
 *                                                        resident page tests can measure the English fallback whatever is
 *                                                        translated; read by src/i18n/untranslated.ts, which also ignores
 *                                                        it on Vercel and during `next build`
 * CVH_FAKE_RESIDENT_DATA_DELETED_ON
 *                      server   optional; local development only (start-up fails on Vercel): a day (YYYY-MM-DD) the terms
 *                                                        page states as the day the pilot's resident data was deleted, instead
 *                                                        of the end-of-pilot purge's completion read from the database (S09.08;
 *                                                        the resident page tests and their screenshots)
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
  SMS_PRICE_PER_SEGMENT_CENTS: optionalText,
  SMS_USD_TO_CAD_RATE: optionalText,
  SMS_TRANSACTIONAL_DAILY_CEILING: optionalText,
  SPEND_PILOT_BUDGET_CENTS: optionalText,
  SPEND_TOKEN_ESTIMATE_CAD_PER_MILLION: optionalText,
  CVH_FAKE_IDENTITY_FILE: optionalText,
  CVH_FAKE_BUILDINGS_FILE: optionalText,
  CVH_FAKE_FEED_FILE: optionalText,
  RESIDENT_ALERTS_ENABLED: optionalText,
  CVH_FAKE_GUIDES_FILE: optionalText,
  CVH_FAKE_DIRECTORY_DIR: optionalText,
  CVH_FAKE_TRANSLATOR: optionalText,
  CVH_FAKE_UNTRANSLATED_KEYS: optionalText,
  CVH_FAKE_RESIDENT_DATA_DELETED_ON: optionalText,
  STAFF_PASSWORD_PEPPER: optionalText,
  JOB_SECRET: optionalText,
  JOB_SECRET_PREVIOUS: optionalText,
  SMS_SEGMENTS_PER_SECOND: optionalText,
  COHERE_API_KEY: optionalText,
  SEARCH_EMBED_MODEL: optionalText,
  SEARCH_THRESHOLD: optionalText,
  SEARCH_EMERGENCY_THRESHOLD: optionalText,
  SEARCH_EMERGENCY_TOP_THRESHOLD: optionalText,
  SEARCH_KEYWORD_WEIGHT: optionalText,
  SEARCH_DIRECT_FLOOR: optionalText,
  SEARCH_DIRECT_GAP: optionalText,
  SEARCH_EMERGENCY_CATEGORIES: optionalText,
  SEARCH_QUESTION_ROUTE: optionalText,
  SEARCH_QUESTION_FALLBACK: optionalText,
  SEARCH_FALLBACK_MIN_BUDGET_MS: optionalText,
  SEARCH_TRANSLATE_MONTHLY_CALLS: optionalText,
  SEARCH_TRANSLATE_FIRST_MONTHLY_CALLS: optionalText,
  SEARCH_RERANK: optionalText,
  SEARCH_RERANK_MIN: optionalText,
  SEARCH_RERANK_MONTHLY_CALLS: optionalText,
  EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH: optionalText,
  EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH: optionalText,
});

type Raw = z.infer<typeof rawSchema>;

/** The settings of search that a release records or the publish job obeys (S03.02). */
export interface SearchSettings {
  /** The Cohere embedding model id. */
  embedModel: string;
  /** Score below which a question has no clear match on the hybrid route (provisional: interim tuning, confirmed by S03.08). */
  threshold: number;
  /** Similarity at which an emergency provider among the top 3 of a leg sets `emergency_first` without a clear match (owner decision 41); at most `threshold`. */
  emergencyThreshold: number;
  /** Similarity at which an emergency provider that is a leg's best match sets `emergency_first`. */
  emergencyTopThreshold: number;
  /** The most the keyword match adds to a similarity on the hybrid route. */
  keywordWeight: number;
  /** The direct route: the least best similarity for any result, and the furthest below it a result may be. */
  directFloor: number;
  directGap: number;
  /** English names of the categories that put the 911 block first. */
  emergencyCategories: string[];
  /** Embedding usage the calendar month may reach: calls and input tokens. */
  allowance: { callsPerMonth: number; tokensPerMonth: number };
  /** `search_question_route` (S03.05): the translation model per kind of question; null switches the translated leg off for it. */
  questionRoute: QuestionRouteSettings;
  /** The model the translated leg retries once with when the routed model is past a limit, per kind of question; null: no retry for it. */
  questionFallback: QuestionRouteSettings;
  /** The least time (ms) that must be left of the leg's budget for the fallback to be tried. */
  fallbackMinBudgetMs: number;
  /** The translation calls a model may use in a calendar month, where the vendor limits them (model id to limit); empty: no warning. */
  translateMonthlyCalls: Readonly<Record<string, number>>;
  /** The translate calls (every purpose) a model's calendar month may reach before translate-first questions are no longer translated. */
  translateFirstMonthlyCalls: number;
  /** Whether the direct route reranks (where a Cohere key is configured). */
  rerank: boolean;
  /** The least rerank relevance of a reranked result. */
  rerankMin: number;
  /** The rerank calls a calendar month may use before the reranker is no longer called. */
  rerankMonthlyCalls: number;
}

/** The kinds of question that also search through English (the translation module's QuestionSource, kept here as plain names). */
export const QUESTION_ROUTE_KINDS = ["ps", "prs", "ur", "romanized_or_mixed", "ambiguous_arabic", "tl", "gu", "ta", "el", "sk", "bn", "hi", "pa", "zh", "es", "fr"] as const;
export type QuestionRouteSettings = Readonly<Record<(typeof QUESTION_ROUTE_KINDS)[number], string | null>>;

/**
 * Translate-first (2026-10-07 measurement, data/search-test-set/reports/2026-10-07-interim-tuning.md, "Translate-first"): the
 * launch languages the multilingual embedding reads poorly enough that translating the question to English first wins clearly
 * (hit@3 up at least 10 points, no-match accuracy no worse): Tamil and Punjabi, with Command A Translate (the model the
 * measurement used) and no fallback model. The others are off (searched directly, with the reranker); a
 * kind can be switched on or off in SEARCH_QUESTION_ROUTE without a code change.
 */
const TRANSLATE_FIRST_ROUTE = {
  ta: "command-a-translate-08-2025",
  pa: "command-a-translate-08-2025",
  tl: null,
  gu: null,
  el: null,
  sk: null,
  bn: null,
  hi: null,
  zh: null,
  es: null,
  fr: null,
} as const;
// No fallback: North Small Translate's month on the production key is alert translation's (S04.02); a translate-first question
// whose model fails or is past its limit takes today's route instead.
const TRANSLATE_FIRST_FALLBACK = {
  ta: null,
  pa: null,
  tl: null,
  gu: null,
  el: null,
  sk: null,
  bn: null,
  hi: null,
  zh: null,
  es: null,
  fr: null,
} as const;

/**
 * PROVISIONAL (the addendum's routing table): North Small Translate for Pashto, Dari and native-script Urdu (owner decision
 * 40, 2026-10-03: the catalogue's model for ur), Command A Translate for the rest.
 */
export const DEFAULT_QUESTION_ROUTE: QuestionRouteSettings = {
  ps: "north-small-translate-09-2026",
  prs: "north-small-translate-09-2026",
  ur: "north-small-translate-09-2026",
  romanized_or_mixed: "command-a-translate-08-2025",
  ambiguous_arabic: "command-a-translate-08-2025",
  ...TRANSLATE_FIRST_ROUTE,
};

/**
 * PROVISIONAL (owner decision 45, 2026-10-03; the addendum's routing table gives Dari's second choice): Command A Translate
 * for Dari, and for native-script Urdu (the addendum says Command A does not write Urdu, but a question is only read into
 * English and the owner tested that it does), and for the kinds whose route already is Command A (there it is skipped, and
 * applies only if their route changes). Pashto has none: Command A Translate returned Dari for Pashto, until S03.07's
 * test set shows it reads Pashto well.
 */
export const DEFAULT_QUESTION_FALLBACK: QuestionRouteSettings = {
  ps: null,
  prs: "command-a-translate-08-2025",
  ur: "command-a-translate-08-2025",
  romanized_or_mixed: "command-a-translate-08-2025",
  ambiguous_arabic: "command-a-translate-08-2025",
  ...TRANSLATE_FIRST_FALLBACK,
};

/** The longest time the leg has (the E03 search time limit, DEFAULT_LEG_TIMEOUT_MS of the directory module): the most a minimum budget can be. */
const LEG_BUDGET_MS = 2200;

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  embedModel: "embed-v4.0",
  threshold: 0.27,
  emergencyThreshold: 0.25,
  emergencyTopThreshold: 0.14,
  keywordWeight: 0.15,
  directFloor: 0.24,
  directGap: 0.1,
  emergencyCategories: ["Support & Emergency Services"],
  allowance: { callsPerMonth: 500, tokensPerMonth: 2_000_000 },
  questionRoute: DEFAULT_QUESTION_ROUTE,
  questionFallback: DEFAULT_QUESTION_FALLBACK,
  fallbackMinBudgetMs: 800,
  translateMonthlyCalls: {},
  translateFirstMonthlyCalls: 600,
  rerank: true,
  rerankMin: 0.05,
  rerankMonthlyCalls: 900,
};

const EMBED_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** PROVISIONAL (S04.06): cents CAD per text message segment until IT records Twilio's price for Canadian toll-free numbers. */
export const DEFAULT_SMS_PRICE_PER_SEGMENT_CENTS = 1.5;

/** PROVISIONAL (S09.01): the daily ceiling on non-alert texts until the owner confirms one (AD-22). */
export const DEFAULT_SMS_TRANSACTIONAL_DAILY_CEILING = 300;

/** The pilot's budget in cents CAD (CAD 1,000, S07.08) until the owner sets another. */
export const DEFAULT_SPEND_PILOT_BUDGET_CENTS = 100_000;

/** PROVISIONAL (S06.08): Canadian dollars per US dollar, the rate Twilio's prices (billed in US dollars) are converted at until the owner sets one. */
export const DEFAULT_SMS_USD_TO_CAD_RATE = 1.4;

/**
 * The launch gate of E04 (S04.08, epics: "Launch gate kept"). E05's corrections and closing are complete in production, so the code lock
 * is released: `RESIDENT_ALERTS_ENABLED=true` now starts in production and turns the gate on. The default stays off (unset or `false` in
 * production), so the switch is only the Vercel variable, set by an Admin with a production redeploy and recorded in the launch-readiness
 * checklist. The configuration test (src/platform/config/residentAlerts.test.ts) pins this.
 */
export const RESIDENT_ALERTS_RELEASED = true;

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
  /** Why TWILIO_FROM_NUMBER is not used although it is set (names the rule, never the value); undefined when nothing is wrong. */
  twilioFromNumberProblem?: string;
  /** Cents CAD per text message segment (at most three decimals): the price an alert's cost estimate uses (S04.06). */
  smsPricePerSegmentCents: number;
  /** Canadian dollars per US dollar (at most four decimals): the rate a reconciliation converts Twilio's prices at (S06.08). */
  smsUsdToCadRate: number;
  /** The daily ceiling on non-alert texts (S09.01, AD-22): the health job's `transactional_ceiling` condition. */
  smsTransactionalDailyCeiling: number;
  /** The pilot's budget in whole cents CAD, shown with the spend (S07.08). */
  spendPilotBudgetCents: number;
  /** CAD per million tokens to estimate Cohere usage whose price is unknown at (S07.08); null when none is configured: such usage is then "price unknown". */
  spendTokenEstimateCadPerMillion: number | null;
  /** Local development only: the identity fake's state file (end-to-end tests). */
  fakeIdentityFile?: string;
  /** Local development only: sample buildings for the resident page tests, read instead of the database. */
  fakeBuildingsFile?: string;
  /** Local development only: the feed's threads for the resident page tests, read instead of the database. */
  fakeFeedFile?: string;
  /** Whether the feed and the alert pages tell residents about any alert (the launch gate, see RESIDENT_ALERTS_RELEASED). */
  residentAlertsEnabled: boolean;
  fakeGuidesFile?: string;
  /** Local development only: the folder the directory release files are kept in (end-to-end tests). */
  fakeDirectoryDir?: string;
  /** Local development only: translate alerts with the fake model that answers every language with a sample text (end-to-end tests). */
  fakeTranslator?: "sample";
  /** Local development only: the day the terms page states resident data was deleted (S09.08, the resident page tests), read instead of the database. */
  fakeResidentDataDeletedOn?: string;
  /** Cohere's API key: set only in production. The publish job embeds search data when it is set, and publishes without when not. */
  cohereApiKey?: string;
  /** The search settings, with their defaults; they apply only where a key is configured. */
  search: SearchSettings;
  /** The password pepper, only when it is set and strong enough; otherwise staffPasswordPepperProblem says why not. */
  staffPasswordPepper?: string;
  /** Why staff passwords are not configured (names the rule, never the value); undefined when they are. */
  staffPasswordPepperProblem?: string;
  /** The secrets a job route accepts as its bearer token: JOB_SECRET, and JOB_SECRET_PREVIOUS during a rotation; only those that are strong enough. Empty: the job routes answer 503. */
  jobSecrets: string[];
  /** Why a job secret was not accepted (names the rule and the variable, never the value); undefined when nothing is wrong. */
  jobSecretProblem?: string;
  /** The shared send pace in SMS segments a second (SMS_SEGMENTS_PER_SECOND; default 3). */
  smsSegmentsPerSecond: number;
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

export const JOB_SECRET_MIN_BYTES = 32;

/**
 * The rule for a job secret (JOB_SECRET, JOB_SECRET_PREVIOUS): at least 32 bytes of key material written as hex or base64, and not
 * an obviously repeated pattern. Returns the problem (naming the variable, never the value), or undefined when the value is usable.
 * Like the pepper it never fails start-up: a job route refuses instead, so a typo cannot take the whole site down.
 */
export function jobSecretProblem(name: string, value: string): string | undefined {
  const trimmed = value.trim();
  let bytes = 0;
  if (/^[0-9a-fA-F]+$/.test(trimmed)) bytes = Math.floor(trimmed.length / 2);
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) bytes = Math.floor((trimmed.replace(/=+$/, "").length * 3) / 4);
  else return `${name}: must be hex or base64 (for example \`openssl rand -hex 32\`)`;
  if (bytes < JOB_SECRET_MIN_BYTES || new Set(trimmed).size < 10) {
    return `${name}: must be at least ${JOB_SECRET_MIN_BYTES} random bytes (for example \`openssl rand -hex 32\`)`;
  }
  return undefined;
}

/** The bearer secrets the job routes accept, and why one was left out. JOB_SECRET_PREVIOUS only counts next to a usable JOB_SECRET and must differ from it. */
function parseJobSecrets(raw: Raw): { secrets: string[]; problem?: string } {
  const problems: string[] = [];
  const secrets: string[] = [];
  const current = raw.JOB_SECRET?.trim();
  const previous = raw.JOB_SECRET_PREVIOUS?.trim();
  if (current !== undefined) {
    const problem = jobSecretProblem("JOB_SECRET", current);
    if (problem) problems.push(problem);
    else secrets.push(current);
  }
  if (previous !== undefined) {
    const problem = jobSecretProblem("JOB_SECRET_PREVIOUS", previous);
    if (problem) problems.push(problem);
    else if (secrets.length === 0) problems.push("JOB_SECRET_PREVIOUS: set without a usable JOB_SECRET (the previous secret only counts during a rotation)");
    else if (previous === current) problems.push("JOB_SECRET_PREVIOUS: must differ from JOB_SECRET");
    else secrets.push(previous);
  }
  return { secrets, problem: problems.length > 0 ? problems.join("; ") : undefined };
}

export const SMS_SEGMENTS_PER_SECOND_DEFAULT = 3;

export const TWILIO_FROM_NUMBER_PROBLEM = "TWILIO_FROM_NUMBER: must be an E.164 number such as +18885550100 (the value is not shown)";

const SMS_PRICE_PROBLEM = "SMS_PRICE_PER_SEGMENT_CENTS: must be a positive number of cents with at most three decimals, no more than 100, such as 1.5";

/** The price of a text message segment in cents CAD: positive, at most three decimals, at most 100; the default when unset. */
function parseSmsPrice(value: string | undefined, problems: string[]): number {
  if (value === undefined) return DEFAULT_SMS_PRICE_PER_SEGMENT_CENTS;
  const text = value.trim();
  const price = Number(text);
  if (!/^[0-9]{1,3}(\.[0-9]{1,3})?$/.test(text) || !(price > 0 && price <= 100)) {
    problems.push(SMS_PRICE_PROBLEM);
    return DEFAULT_SMS_PRICE_PER_SEGMENT_CENTS;
  }
  return price;
}

const SMS_RATE_PROBLEM = "SMS_USD_TO_CAD_RATE: must be a positive number with at most four decimals, between 0.5 and 5, such as 1.4";

/** The exchange rate (CAD per USD) a reconciliation converts at: positive, at most four decimals, between 0.5 and 5; the default when unset. */
function parseSmsRate(value: string | undefined, problems: string[]): number {
  if (value === undefined) return DEFAULT_SMS_USD_TO_CAD_RATE;
  const text = value.trim();
  const rate = Number(text);
  if (!/^[0-9]{1,2}(\.[0-9]{1,4})?$/.test(text) || !(rate >= 0.5 && rate <= 5)) {
    problems.push(SMS_RATE_PROBLEM);
    return DEFAULT_SMS_USD_TO_CAD_RATE;
  }
  return rate;
}

const TOKEN_ESTIMATE_PROBLEM = "SPEND_TOKEN_ESTIMATE_CAD_PER_MILLION: must be a positive number of dollars per million tokens with at most four decimals, such as 0.5";

/** The estimate rate for Cohere usage whose price is unknown: positive, at most four decimals, at most 10000; null when unset (or a problem, named without the value). */
function parseTokenEstimate(value: string | undefined, problems: string[]): number | null {
  if (value === undefined) return null;
  const text = value.trim();
  const rate = Number(text);
  if (!/^[0-9]{1,5}(\.[0-9]{1,4})?$/.test(text) || !(rate > 0 && rate <= 10_000)) {
    problems.push(TOKEN_ESTIMATE_PROBLEM);
    return null;
  }
  return rate;
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

const questionKindsProblem = (name: string) =>
  `${name}: must be \`off\`, or comma-separated kind=model pairs (kinds ${QUESTION_ROUTE_KINDS.join(", ")}; model a model id or off), each kind at most once`;

/** A per-kind setting (the route and the fallback share the shape): `off` alone, or `kind=model|off` pairs over the defaults. */
function parseQuestionKinds(name: string, value: string | undefined, defaults: QuestionRouteSettings, problems: string[]): QuestionRouteSettings {
  if (value === undefined) return defaults;
  const text = value.trim();
  if (text === "off") return Object.fromEntries(QUESTION_ROUTE_KINDS.map((kind) => [kind, null])) as unknown as QuestionRouteSettings;
  const settings: Record<string, string | null> = { ...defaults };
  const seen = new Set<string>();
  for (const pair of text.split(",").map((p) => p.trim()).filter((p) => p !== "")) {
    const match = /^([a-z_]+)\s*=\s*(\S+)$/.exec(pair);
    const kind = match?.[1];
    const model = match?.[2];
    if (!kind || !model || !(QUESTION_ROUTE_KINDS as readonly string[]).includes(kind) || seen.has(kind) || (model !== "off" && !EMBED_MODEL_ID.test(model))) {
      problems.push(questionKindsProblem(name));
      return defaults;
    }
    seen.add(kind);
    settings[kind] = model === "off" ? null : model;
  }
  if (seen.size === 0) {
    problems.push(questionKindsProblem(name));
    return defaults;
  }
  return settings as QuestionRouteSettings;
}

/** The least time left for the fallback: a whole number of milliseconds from 0 to the leg's 2.2 s. */
function parseFallbackMinBudget(value: string | undefined, problems: string[]): number {
  const fallback = DEFAULT_SEARCH_SETTINGS.fallbackMinBudgetMs;
  if (value === undefined) return fallback;
  const text = value.trim();
  if (!/^[0-9]{1,4}$/.test(text) || Number(text) > LEG_BUDGET_MS) {
    problems.push(`SEARCH_FALLBACK_MIN_BUDGET_MS: must be a whole number of milliseconds from 0 to ${LEG_BUDGET_MS}`);
    return fallback;
  }
  return Number(text);
}

const TRANSLATE_MONTHLY_CALLS_PROBLEM = "SEARCH_TRANSLATE_MONTHLY_CALLS: must be comma-separated model=limit pairs (model a model id, limit a whole number of at least 1), each model at most once";

/** The monthly calls a model may use, per model, or none (no warning) when unset. */
function parseTranslateMonthlyCalls(value: string | undefined, problems: string[]): Readonly<Record<string, number>> {
  if (value === undefined) return DEFAULT_SEARCH_SETTINGS.translateMonthlyCalls;
  const limits: Record<string, number> = {};
  for (const pair of value.split(",").map((p) => p.trim()).filter((p) => p !== "")) {
    const match = /^(\S+?)\s*=\s*([0-9]{1,9})$/.exec(pair);
    const model = match?.[1];
    const limit = Number(match?.[2]);
    if (!model || !EMBED_MODEL_ID.test(model) || !(limit >= 1) || Object.hasOwn(limits, model)) {
      problems.push(TRANSLATE_MONTHLY_CALLS_PROBLEM);
      return DEFAULT_SEARCH_SETTINGS.translateMonthlyCalls;
    }
    limits[model] = limit;
  }
  if (Object.keys(limits).length === 0) {
    problems.push(TRANSLATE_MONTHLY_CALLS_PROBLEM);
    return DEFAULT_SEARCH_SETTINGS.translateMonthlyCalls;
  }
  return limits;
}

/** SEARCH_RERANK: `on` or `off` (any case); unset is the default (on). */
function parseRerankSwitch(value: string | undefined, problems: string[]): boolean {
  if (value === undefined) return DEFAULT_SEARCH_SETTINGS.rerank;
  const text = value.trim().toLowerCase();
  if (text === "on") return true;
  if (text === "off") return false;
  problems.push("SEARCH_RERANK: must be `on` or `off`");
  return DEFAULT_SEARCH_SETTINGS.rerank;
}

/** A search setting from 0 to 1 (the form of SEARCH_THRESHOLD), or its default when unset. */
function unitNumber(name: string, raw: string | undefined, fallback: number, example: string, problems: string[]): number {
  if (raw === undefined) return fallback;
  const text = raw.trim();
  const value = Number(text);
  if (!/^[0-9]*\.?[0-9]+$/.test(text) || !(value >= 0 && value <= 1)) {
    problems.push(`${name}: must be a number from 0 to 1, such as ${example}`);
    return fallback;
  }
  return value;
}

function parseSearchSettings(raw: Raw, problems: string[]): SearchSettings {
  const defaults = DEFAULT_SEARCH_SETTINGS;
  const embedModel = raw.SEARCH_EMBED_MODEL?.trim() ?? defaults.embedModel;
  if (!EMBED_MODEL_ID.test(embedModel)) problems.push("SEARCH_EMBED_MODEL: must be a model id such as embed-v4.0 (letters, digits, dots, hyphens, underscores)");
  let threshold = defaults.threshold;
  if (raw.SEARCH_THRESHOLD !== undefined) {
    const text = raw.SEARCH_THRESHOLD.trim();
    const value = Number(text);
    if (!/^[0-9]*\.?[0-9]+$/.test(text) || !(value >= 0 && value <= 1)) problems.push("SEARCH_THRESHOLD: must be a number from 0 to 1, such as 0.27");
    else threshold = value;
  }
  let emergencyThreshold = defaults.emergencyThreshold;
  if (raw.SEARCH_EMERGENCY_THRESHOLD !== undefined) {
    const text = raw.SEARCH_EMERGENCY_THRESHOLD.trim();
    const value = Number(text);
    if (!/^[0-9]*\.?[0-9]+$/.test(text) || !(value >= 0 && value <= 1)) problems.push("SEARCH_EMERGENCY_THRESHOLD: must be a number from 0 to 1, such as 0.25");
    else emergencyThreshold = value;
  }
  if (emergencyThreshold > threshold) problems.push("SEARCH_EMERGENCY_THRESHOLD: must be no greater than SEARCH_THRESHOLD");
  const emergencyTopThreshold = unitNumber("SEARCH_EMERGENCY_TOP_THRESHOLD", raw.SEARCH_EMERGENCY_TOP_THRESHOLD, defaults.emergencyTopThreshold, "0.14", problems);
  const keywordWeight = unitNumber("SEARCH_KEYWORD_WEIGHT", raw.SEARCH_KEYWORD_WEIGHT, defaults.keywordWeight, "0.15", problems);
  const directFloor = unitNumber("SEARCH_DIRECT_FLOOR", raw.SEARCH_DIRECT_FLOOR, defaults.directFloor, "0.24", problems);
  const directGap = unitNumber("SEARCH_DIRECT_GAP", raw.SEARCH_DIRECT_GAP, defaults.directGap, "0.1", problems);
  let emergencyCategories = defaults.emergencyCategories;
  if (raw.SEARCH_EMERGENCY_CATEGORIES !== undefined) {
    const names = [...new Set(raw.SEARCH_EMERGENCY_CATEGORIES.split(",").map((name) => name.trim()).filter((name) => name !== ""))];
    if (names.length === 0 || names.some((name) => name.length > 100)) problems.push("SEARCH_EMERGENCY_CATEGORIES: must list at least one category name, separated by commas (each at most 100 characters)");
    else emergencyCategories = names;
  }
  return {
    embedModel,
    threshold,
    emergencyThreshold,
    emergencyTopThreshold,
    keywordWeight,
    directFloor,
    directGap,
    emergencyCategories,
    allowance: {
      callsPerMonth: positiveInteger("EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH", raw.EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH, defaults.allowance.callsPerMonth, problems),
      tokensPerMonth: positiveInteger("EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH", raw.EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH, defaults.allowance.tokensPerMonth, problems),
    },
    questionRoute: parseQuestionKinds("SEARCH_QUESTION_ROUTE", raw.SEARCH_QUESTION_ROUTE, DEFAULT_QUESTION_ROUTE, problems),
    questionFallback: parseQuestionKinds("SEARCH_QUESTION_FALLBACK", raw.SEARCH_QUESTION_FALLBACK, DEFAULT_QUESTION_FALLBACK, problems),
    fallbackMinBudgetMs: parseFallbackMinBudget(raw.SEARCH_FALLBACK_MIN_BUDGET_MS, problems),
    translateMonthlyCalls: parseTranslateMonthlyCalls(raw.SEARCH_TRANSLATE_MONTHLY_CALLS, problems),
    translateFirstMonthlyCalls: positiveInteger("SEARCH_TRANSLATE_FIRST_MONTHLY_CALLS", raw.SEARCH_TRANSLATE_FIRST_MONTHLY_CALLS, defaults.translateFirstMonthlyCalls, problems),
    rerank: parseRerankSwitch(raw.SEARCH_RERANK, problems),
    rerankMin: unitNumber("SEARCH_RERANK_MIN", raw.SEARCH_RERANK_MIN, defaults.rerankMin, "0.05", problems),
    rerankMonthlyCalls: positiveInteger("SEARCH_RERANK_MONTHLY_CALLS", raw.SEARCH_RERANK_MONTHLY_CALLS, defaults.rerankMonthlyCalls, problems),
  };
}

/**
 * The search settings alone, from a variable map, by the same rules as `parseEnv` (the same defaults, the same checks, the same
 * messages): what a script that is not the app, the search test-set runner, resolves SEARCH_* with, so that it measures the
 * settings production resolves from the same values. Throws EnvError listing every rule that failed. It looks at no other variable.
 */
export function parseSearchEnv(source: Record<string, string | undefined>): SearchSettings {
  const problems: string[] = [];
  const search = parseSearchSettings(rawSchema.parse(source), problems);
  if (problems.length > 0) throw new EnvError(problems);
  return search;
}

/**
 * The launch gate. Production: off unless RESIDENT_ALERTS_ENABLED is `true`; while RESIDENT_ALERTS_RELEASED is false (the code lock, released as
 * of E05) `true` is refused, so a setting in Vercel could not show residents an alert early. Everywhere
 * else the default is on (previews run with it on), and `false` turns it off. Anything but `true` or `false` is refused.
 */
function parseResidentAlerts(value: string | undefined, environment: AppEnvironment, problems: string[]): boolean {
  const normal = value === undefined ? undefined : value.trim().toLowerCase();
  if (normal !== undefined && normal !== "true" && normal !== "false") {
    problems.push(`RESIDENT_ALERTS_ENABLED: must be "true" or "false", not ${shown(value as string)}`);
    return false;
  }
  if (environment === "production") {
    if (normal === "true" && !RESIDENT_ALERTS_RELEASED) {
      problems.push("RESIDENT_ALERTS_ENABLED: must not be \"true\" in production until E05's corrections and closing are released (S04.08, RESIDENT_ALERTS_RELEASED)");
      return false;
    }
    return normal === "true";
  }
  return normal !== "false";
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
  const jobSecrets = parseJobSecrets(raw);
  let smsSegmentsPerSecond = SMS_SEGMENTS_PER_SECOND_DEFAULT;
  if (raw.SMS_SEGMENTS_PER_SECOND !== undefined) {
    const text = raw.SMS_SEGMENTS_PER_SECOND.trim();
    if (!/^[0-9]{1,3}$/.test(text) || Number(text) < 1 || Number(text) > 100) problems.push("SMS_SEGMENTS_PER_SECOND: must be a whole number from 1 to 100");
    else smsSegmentsPerSecond = Number(text);
  }
  const smsPricePerSegmentCents = parseSmsPrice(raw.SMS_PRICE_PER_SEGMENT_CENTS, problems);
  const smsUsdToCadRate = parseSmsRate(raw.SMS_USD_TO_CAD_RATE, problems);
  const smsTransactionalDailyCeiling = positiveInteger("SMS_TRANSACTIONAL_DAILY_CEILING", raw.SMS_TRANSACTIONAL_DAILY_CEILING, DEFAULT_SMS_TRANSACTIONAL_DAILY_CEILING, problems);
  const spendPilotBudgetCents = positiveInteger("SPEND_PILOT_BUDGET_CENTS", raw.SPEND_PILOT_BUDGET_CENTS, DEFAULT_SPEND_PILOT_BUDGET_CENTS, problems);
  const spendTokenEstimateCadPerMillion = parseTokenEstimate(raw.SPEND_TOKEN_ESTIMATE_CAD_PER_MILLION, problems);

  // A typo in the number residents text START to must not take the whole site down at every cold start (the staffPasswordPepperProblem pattern): it is dropped.
  const fromNumber = raw.TWILIO_FROM_NUMBER?.trim();
  const fromNumberProblem = environment === "production" && fromNumber !== undefined && !E164_PATTERN.test(fromNumber);

  const onVercel = raw.VERCEL !== undefined || raw.VERCEL_ENV !== undefined;
  if ((environment !== "development" || onVercel) && raw.CVH_FAKE_IDENTITY_FILE !== undefined) {
    problems.push("CVH_FAKE_IDENTITY_FILE: the identity fake is only allowed in local development, never on Vercel");
  }

  if ((environment !== "development" || onVercel) && raw.CVH_FAKE_BUILDINGS_FILE !== undefined) {
    problems.push("CVH_FAKE_BUILDINGS_FILE: the buildings fake is only allowed in local development, never on Vercel");
  }
  if ((environment !== "development" || onVercel) && raw.CVH_FAKE_FEED_FILE !== undefined) {
    problems.push("CVH_FAKE_FEED_FILE: the feed fake is only allowed in local development, never on Vercel");
  }
  const residentAlertsEnabled = parseResidentAlerts(raw.RESIDENT_ALERTS_ENABLED, environment, problems);
  if ((environment !== "development" || onVercel) && raw.CVH_FAKE_GUIDES_FILE !== undefined) {
    problems.push("CVH_FAKE_GUIDES_FILE: the guides fake is only allowed in local development, never on Vercel");
  }
  if ((environment !== "development" || onVercel) && raw.CVH_FAKE_DIRECTORY_DIR !== undefined) {
    problems.push("CVH_FAKE_DIRECTORY_DIR: the local directory store is only allowed in local development, never on Vercel");
  } else if (raw.CVH_FAKE_DIRECTORY_DIR !== undefined && !ABSOLUTE_PATH.test(raw.CVH_FAKE_DIRECTORY_DIR)) {
    problems.push("CVH_FAKE_DIRECTORY_DIR: must be an absolute path");
  }
  if ((environment !== "development" || onVercel) && raw.CVH_FAKE_TRANSLATOR !== undefined) {
    problems.push("CVH_FAKE_TRANSLATOR: the translation fake is only allowed in local development, never on Vercel");
  } else if (raw.CVH_FAKE_TRANSLATOR !== undefined && raw.CVH_FAKE_TRANSLATOR !== "sample") {
    problems.push('CVH_FAKE_TRANSLATOR: the only fake is "sample"');
  }
  if ((environment !== "development" || onVercel) && raw.CVH_FAKE_RESIDENT_DATA_DELETED_ON !== undefined) {
    problems.push("CVH_FAKE_RESIDENT_DATA_DELETED_ON: the end-of-pilot date fake is only allowed in local development, never on Vercel");
  } else if (raw.CVH_FAKE_RESIDENT_DATA_DELETED_ON !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(raw.CVH_FAKE_RESIDENT_DATA_DELETED_ON)) {
    problems.push("CVH_FAKE_RESIDENT_DATA_DELETED_ON: must be a day written YYYY-MM-DD");
  }

  if ((environment !== "development" || onVercel) && raw.CVH_FAKE_UNTRANSLATED_KEYS !== undefined) {
    problems.push("CVH_FAKE_UNTRANSLATED_KEYS: the English-fallback test seam is only allowed in local development, never on Vercel");
  } else if (raw.CVH_FAKE_UNTRANSLATED_KEYS !== undefined) {
    const { problem } = parseUntranslatedKeys(raw.CVH_FAKE_UNTRANSLATED_KEYS);
    if (problem !== undefined) problems.push(`CVH_FAKE_UNTRANSLATED_KEYS: ${problem}`);
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
      if (name.includes("JOB_SECRET") || [raw.JOB_SECRET?.trim(), raw.JOB_SECRET_PREVIOUS?.trim()].some((secret) => secret !== undefined && value.trim() === secret)) {
        problems.push(`${name}: holds or names a job secret; NEXT_PUBLIC_ variables are sent to browsers`);
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
    twilioFromNumberProblem: fromNumberProblem ? TWILIO_FROM_NUMBER_PROBLEM : undefined,
    smsPricePerSegmentCents,
    smsUsdToCadRate,
    smsTransactionalDailyCeiling,
    spendPilotBudgetCents,
    spendTokenEstimateCadPerMillion,
    cohereApiKey: raw.COHERE_API_KEY?.trim(),
    search,
    fakeIdentityFile: raw.CVH_FAKE_IDENTITY_FILE,
    fakeBuildingsFile: raw.CVH_FAKE_BUILDINGS_FILE,
    fakeFeedFile: raw.CVH_FAKE_FEED_FILE,
    residentAlertsEnabled,
    fakeGuidesFile: raw.CVH_FAKE_GUIDES_FILE,
    fakeDirectoryDir: raw.CVH_FAKE_DIRECTORY_DIR,
    fakeTranslator: raw.CVH_FAKE_TRANSLATOR === "sample" ? "sample" : undefined,
    fakeResidentDataDeletedOn: raw.CVH_FAKE_RESIDENT_DATA_DELETED_ON,
    ...pepperSettings(raw.STAFF_PASSWORD_PEPPER),
    jobSecrets: jobSecrets.secrets,
    jobSecretProblem: jobSecrets.problem,
    smsSegmentsPerSecond,
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
  // A misconfigured number residents text START to never stops the server; the rule is logged (never the value) so IT can fix it.
  if (cached.twilioFromNumberProblem !== undefined) {
    console.error(JSON.stringify({ level: "error", evt: "env.twilio_from_number_not_valid", module: "platform", rule: cached.twilioFromNumberProblem }));
  }
  // Likewise a job secret that is too weak never stops the server: the job routes refuse until it is fixed.
  if (cached.jobSecretProblem !== undefined) {
    console.error(JSON.stringify({ level: "error", evt: "env.job_secret_not_accepted", module: "platform", rule: cached.jobSecretProblem }));
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
