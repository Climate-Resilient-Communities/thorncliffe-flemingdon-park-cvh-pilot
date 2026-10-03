// The translation latency measurement (S04.01, AR-14): the plan and its usage guard, the run, the report, and the
// timeout rule that turns a report into per-(language, model) attempt timeouts and route deadlines. Pure except
// `createCohereCaller`, which wraps a vendor client the caller passes in. The command line is in main.ts.
//
// Cohere caps its newer models at 1,000 calls a month per key per model, and production searches spend the same
// allowance, so nothing here calls a model before the whole plan has been counted per (key, model) and checked against
// an explicit ceiling, and a model that answers "per-month request limit" is stopped at once.
import { createHash } from "node:crypto";
import { z } from "zod";
import { LangCodeSchema, type LangCode } from "@/contracts/lang";
import { cohereTranslator, type CohereChatClient } from "@/modules/translation/adapters/cohereTranslator";
import { TranslateError } from "@/modules/translation/application/ports";
import { percentile } from "../search-test-set/lib";

export const TEXTS_FILE = "data/translation-latency/texts.json";
export const REPORTS_DIR = "data/translation-latency";
export const REPORT_SCHEMA = "cvh.translation-latency/v1";

// --- routes ---------------------------------------------------------------------------------------

export const MODELS = {
  commandATranslate: "command-a-translate-08-2025",
  northSmallTranslate: "north-small-translate-09-2026",
  tinyAyaFire: "tiny-aya-fire",
  tinyAyaWater: "tiny-aya-water",
} as const;

const { commandATranslate: CMD, northSmallTranslate: NORTH, tinyAyaFire: FIRE, tinyAyaWater: WATER } = MODELS;

/**
 * The provisional routes: the addendum's routing table ("Translation routing (Cohere only)"), the same order as
 * scripts/translate_catalogue.py. S04.02 seeds `translation_route` from the same table; once it is merged, a route
 * file read from the table can be passed with --routes. English needs no translation and zh-Hant is converted from zh
 * with OpenCC, so neither is measured.
 */
export const PROVISIONAL_ROUTES: Readonly<Partial<Record<LangCode, readonly string[]>>> = {
  ur: [NORTH, FIRE],
  ps: [NORTH], // Command A Translate returned Dari for Pashto
  tl: [NORTH, WATER],
  prs: [NORTH, CMD],
  gu: [FIRE, NORTH], // not on North Small Translate's official list
  ta: [NORTH, FIRE],
  el: [CMD, NORTH],
  sk: [NORTH, WATER],
  bn: [NORTH, FIRE],
  hi: [CMD, NORTH],
  pa: [NORTH, FIRE],
  zh: [CMD, NORTH],
  es: [CMD, NORTH],
  fr: [CMD, NORTH],
};

export type Routes = Partial<Record<LangCode, readonly string[]>>;

const ModelIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const RoutesSchema = z.partialRecord(LangCodeSchema, z.array(ModelIdSchema).min(1)).refine((r) => !("en" in r) && !("zh-Hant" in r), {
  message: "en and zh-Hant are not translated by a model",
});

/** A routes file (`{"ps": ["north-small-translate-09-2026"], ...}`), or throws with the reason. */
export function parseRoutes(json: string): Routes {
  const parsed = RoutesSchema.safeParse(JSON.parse(json));
  if (!parsed.success) throw new Error(`routes file is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".") || "routes"}: ${i.message}`).join("; ")}`);
  return parsed.data as Routes;
}

// --- texts ----------------------------------------------------------------------------------------

export const TextSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["ack", "alert"]),
  source: z.string().min(1),
  text: z.string().min(1).max(600),
});
export type LatencyText = z.infer<typeof TextSchema>;
const TextsFileSchema = z.strictObject({ note: z.string(), texts: z.array(TextSchema).min(1) });

/** The texts file and its sha256 (recorded in the report, so two reports can be compared or merged only on the same texts). */
export function parseTexts(bytes: Buffer | string): { texts: LatencyText[]; sha256: string } {
  const { texts } = TextsFileSchema.parse(JSON.parse(bytes.toString()));
  const ids = new Set<string>();
  for (const t of texts) {
    if (ids.has(t.id)) throw new Error(`text id ${t.id} appears twice`);
    ids.add(t.id);
  }
  return { texts, sha256: createHash("sha256").update(bytes).digest("hex") };
}

// --- the plan and the usage guard -----------------------------------------------------------------

export interface Selection {
  routes: Routes;
  /** Languages to measure (default: every language in the routes). */
  langs?: readonly LangCode[];
  /** Models to measure (default: every model in the selected routes). */
  models?: readonly string[];
  /** Route positions, 1-based (default: every position). `1` measures each language's first choice only. */
  positions?: readonly number[];
  /** Text ids (default: every text). */
  textIds?: readonly string[];
  repetitions: number;
  /** The env var that holds the key for every model, unless `keyVarFor` names another for a model. */
  keyVar: string;
  keyVarFor?: Readonly<Record<string, string>>;
}

export interface PlannedCall {
  lang: LangCode;
  model: string;
  /** 1-based position of the model in the language's route. */
  position: number;
  textId: string;
  /** 1-based repetition. */
  rep: number;
  /** The name of the env var that holds the key (never the key). */
  keyVar: string;
}

/** Every call the selection makes, in run order: repetition, then text, then language, then route position. */
export function planCalls(texts: readonly LatencyText[], sel: Selection): PlannedCall[] {
  if (!Number.isInteger(sel.repetitions) || sel.repetitions < 1) throw new Error("repetitions must be a whole number of at least 1");
  const langs = (sel.langs ?? (Object.keys(sel.routes) as LangCode[])).slice();
  for (const lang of langs) if (!sel.routes[lang]) throw new Error(`no route for ${lang}`);
  const chosen = sel.textIds ? texts.filter((t) => sel.textIds!.includes(t.id)) : texts;
  if (sel.textIds) for (const id of sel.textIds) if (!texts.some((t) => t.id === id)) throw new Error(`no text with id ${id}`);
  const calls: PlannedCall[] = [];
  for (let rep = 1; rep <= sel.repetitions; rep++) {
    for (const text of chosen) {
      for (const lang of langs) {
        sel.routes[lang]!.forEach((model, index) => {
          const position = index + 1;
          if (sel.models && !sel.models.includes(model)) return;
          if (sel.positions && !sel.positions.includes(position)) return;
          calls.push({ lang, model, position, textId: text.id, rep, keyVar: sel.keyVarFor?.[model] ?? sel.keyVar });
        });
      }
    }
  }
  return calls;
}

export interface PlanRow {
  keyVar: string;
  model: string;
  calls: number;
  langs: LangCode[];
}

/** Calls per (key, model): Cohere's monthly cap is per key per model. */
export function summarisePlan(calls: readonly PlannedCall[]): PlanRow[] {
  const rows = new Map<string, PlanRow>();
  for (const c of calls) {
    const key = `${c.keyVar}\u0000${c.model}`;
    const row = rows.get(key) ?? { keyVar: c.keyVar, model: c.model, calls: 0, langs: [] };
    row.calls++;
    if (!row.langs.includes(c.lang)) row.langs.push(c.lang);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.keyVar.localeCompare(b.keyVar) || a.model.localeCompare(b.model));
}

export function formatPlan(rows: readonly PlanRow[], repetitions: number, textCount: number): string[] {
  const total = rows.reduce((n, r) => n + r.calls, 0);
  return [
    `Plan: ${textCount} text(s) x ${repetitions} repetition(s), ${total} call(s) in all`,
    ...rows.map((r) => `  ${r.keyVar.padEnd(18)} ${r.model.padEnd(32)} ${String(r.calls).padStart(5)} call(s)  (${r.langs.join(", ")})`),
  ];
}

/**
 * The usage guard: the run starts only if every (key, model) plans at most `maxCallsPerModel` calls. The ceiling has
 * no default: whoever runs it states what each model's allowance can spare.
 */
export function checkGuard(rows: readonly PlanRow[], maxCallsPerModel: number | undefined): string[] {
  if (maxCallsPerModel === undefined) return ["--max-calls-per-model <n> is required: say how many calls each model's monthly allowance on this key can spare"];
  if (!Number.isInteger(maxCallsPerModel) || maxCallsPerModel < 1) return ["--max-calls-per-model must be a whole number of at least 1"];
  return rows
    .filter((r) => r.calls > maxCallsPerModel)
    .map((r) => `${r.model} on ${r.keyVar} plans ${r.calls} calls, more than --max-calls-per-model ${maxCallsPerModel}`);
}

// --- one call -------------------------------------------------------------------------------------

/**
 * What a call came to. `ok`, `empty` and `wrong_script` mean the model answered (its time is a latency sample);
 * `timeout` and `error` are failed attempts; `rate_limited` (a per-minute 429) and `quota_exhausted` (the per-month
 * limit) are the key's limits, not the model's, so they are counted apart; `auth_failed` stops the run.
 */
export const OUTCOMES = ["ok", "empty", "wrong_script", "timeout", "error", "rate_limited", "quota_exhausted", "auth_failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];
const ANSWERED: readonly Outcome[] = ["ok", "empty", "wrong_script"];
const MODEL_FAILURES: readonly Outcome[] = ["empty", "wrong_script", "timeout", "error"];

export interface CallResult {
  outcome: Outcome;
  ms: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type Caller = (call: PlannedCall, text: string) => Promise<CallResult>;

// The script each language is written in. This is a light check so the failure count is not blind to an answer in the
// wrong script (English echoed back, say); it is not S04.02's check (eld, Pashto marker letters, Urdu-only letters),
// which the alert route will apply. Latin-script languages cannot be told from English this way and always pass.
const SCRIPT_OF: Partial<Record<LangCode, RegExp>> = {
  ur: /\p{Script=Arabic}/u,
  ps: /\p{Script=Arabic}/u,
  prs: /\p{Script=Arabic}/u,
  hi: /\p{Script=Devanagari}/u,
  bn: /\p{Script=Bengali}/u,
  pa: /\p{Script=Gurmukhi}/u,
  gu: /\p{Script=Gujarati}/u,
  ta: /\p{Script=Tamil}/u,
  el: /\p{Script=Greek}/u,
  zh: /\p{Script=Han}/u,
  tl: /\p{Script=Latin}/u,
  sk: /\p{Script=Latin}/u,
  es: /\p{Script=Latin}/u,
  fr: /\p{Script=Latin}/u,
};
export const OUTPUT_CHECK = "script-share-v1";

/**
 * `ok`, `empty`, or `wrong_script`: fewer than a fifth of the letters are in the language's script. Not a half, because a
 * faithful translation keeps names in Latin letters ("Toronto Hydro", "Sample Tower A"); English echoed back has none.
 */
export function checkOutput(lang: LangCode, output: string): "ok" | "empty" | "wrong_script" {
  const letters = [...output.trim()].filter((ch) => /\p{L}/u.test(ch));
  if (letters.length === 0) return "empty";
  const script = SCRIPT_OF[lang];
  if (!script) return "ok";
  const inScript = letters.filter((ch) => script.test(ch)).length;
  return inScript * 5 >= letters.length ? "ok" : "wrong_script";
}

/** What a vendor error says, as a status and a flag: the message itself is never kept (it may echo the text, AD-3). */
export function classifyVendorError(error: unknown): { status: number | null; monthlyQuota: boolean } {
  const e = error as { statusCode?: unknown; status?: unknown; body?: unknown; message?: unknown } | null;
  const status = typeof e?.statusCode === "number" ? e.statusCode : typeof e?.status === "number" ? e.status : null;
  if (status !== 429) return { status, monthlyQuota: false };
  const body = e?.body as { message?: unknown } | string | undefined;
  const said = [typeof body === "string" ? body : typeof body?.message === "string" ? body.message : "", typeof e?.message === "string" ? e.message : ""].join(" ");
  return { status, monthlyQuota: /month/i.test(said) };
}

export interface CohereCallerOptions {
  /** The vendor client for a key's env var name (the real CohereClient, or a fake in tests). */
  clientFor: (keyVar: string) => CohereChatClient;
  /** The longest answer asked for. The adapter asks for 200 tokens (enough for a question); an alert needs more. */
  maxOutputTokens: number;
  /** A call still unanswered after this long is a `timeout`. Generous, so the tail is measured, not cut. */
  callTimeoutMs: number;
  now?: () => number;
}

/**
 * Calls each model through the app's own adapter (`cohereTranslator`: its system prompt, temperature 0, no retries),
 * so the times include what production's code path does. Two things are wrapped around the vendor client the adapter
 * is given: the answer length (`maxOutputTokens`, see above) and the error's status, which the adapter rightly drops
 * whole but the usage guard needs (429 per month, 429 per minute, 401).
 */
export function createCohereCaller(options: CohereCallerOptions): Caller {
  const now = options.now ?? (() => performance.now());
  const perKey = new Map<string, { translate: ReturnType<typeof cohereTranslator>; last: { error: unknown } }>();
  const forKey = (keyVar: string) => {
    let entry = perKey.get(keyVar);
    if (!entry) {
      const inner = options.clientFor(keyVar);
      const last = { error: undefined as unknown };
      const client: CohereChatClient = {
        v2: {
          chat: async (request, callOptions) => {
            last.error = undefined;
            try {
              return await inner.v2.chat({ ...request, maxTokens: options.maxOutputTokens }, callOptions);
            } catch (error) {
              last.error = error;
              throw error;
            }
          },
        },
      };
      entry = { translate: cohereTranslator({ apiKey: "unused: the client is given", client }), last };
      perKey.set(keyVar, entry);
    }
    return entry;
  };
  return async (call, text) => {
    const { translate, last } = forKey(call.keyVar);
    const signal = AbortSignal.timeout(options.callTimeoutMs);
    const start = now();
    try {
      const answer = await translate.translate({ text, from: "en", to: call.lang, model: call.model, signal });
      const ms = now() - start;
      return { outcome: checkOutput(call.lang, answer.text), ms, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens };
    } catch (error) {
      const ms = now() - start;
      const blank = { ms, inputTokens: null, outputTokens: null };
      if (error instanceof TranslateError && error.code === "aborted") return { outcome: "timeout", ...blank };
      const { status, monthlyQuota } = classifyVendorError(last.error);
      if (status === 429) return { outcome: monthlyQuota ? "quota_exhausted" : "rate_limited", ...blank };
      if (status === 401 || status === 403) return { outcome: "auth_failed", ...blank };
      return { outcome: "error", ...blank };
    }
  };
}

// --- the run --------------------------------------------------------------------------------------

export const SampleSchema = z.strictObject({
  lang: LangCodeSchema,
  model: ModelIdSchema,
  position: z.number().int().min(1),
  text_id: z.string(),
  rep: z.number().int().min(1),
  key_var: z.string(),
  outcome: z.enum(OUTCOMES),
  ms: z.number().min(0),
  input_tokens: z.number().int().min(0).nullable(),
  output_tokens: z.number().int().min(0).nullable(),
});
export type Sample = z.infer<typeof SampleSchema>;

export const sampleKey = (s: { lang: string; model: string; text_id?: string; textId?: string; rep: number }) => `${s.lang}|${s.model}|${s.text_id ?? s.textId}|${s.rep}`;

export interface StoppedModel {
  key_var: string;
  model: string;
  reason: "quota_exhausted" | "auth_failed" | "ceiling";
  /** Planned calls not made because of the stop. */
  skipped: number;
}

export interface RunResult {
  samples: Sample[];
  stopped: StoppedModel[];
}

/**
 * Makes the planned calls one after another (never in parallel: the times are of one call, and parallel calls would
 * meet the per-minute limit). A (key, model) is stopped at its first per-month 429, and never makes more than
 * `maxCallsPerModel` calls; a rejected key stops every model on it.
 */
export async function runPlan(
  calls: readonly PlannedCall[],
  texts: ReadonlyMap<string, string>,
  caller: Caller,
  options: { maxCallsPerModel: number; onSample?: (sample: Sample, index: number, total: number) => void },
): Promise<RunResult> {
  const made = new Map<string, number>();
  const stopped = new Map<string, StoppedModel>();
  const deadKeys = new Map<string, StoppedModel["reason"]>();
  const samples: Sample[] = [];
  for (const [index, call] of calls.entries()) {
    const id = `${call.keyVar}\u0000${call.model}`;
    const reason = deadKeys.get(call.keyVar) ?? stopped.get(id)?.reason ?? ((made.get(id) ?? 0) >= options.maxCallsPerModel ? "ceiling" : undefined);
    if (reason) {
      const entry = stopped.get(id) ?? { key_var: call.keyVar, model: call.model, reason, skipped: 0 };
      entry.skipped++;
      stopped.set(id, entry);
      continue;
    }
    made.set(id, (made.get(id) ?? 0) + 1);
    const text = texts.get(call.textId);
    if (text === undefined) throw new Error(`no text with id ${call.textId}`);
    const result = await caller(call, text);
    const sample: Sample = {
      lang: call.lang,
      model: call.model,
      position: call.position,
      text_id: call.textId,
      rep: call.rep,
      key_var: call.keyVar,
      outcome: result.outcome,
      ms: Math.round(result.ms * 10) / 10,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    };
    samples.push(sample);
    options.onSample?.(sample, index, calls.length);
    if (result.outcome === "quota_exhausted") stopped.set(id, { key_var: call.keyVar, model: call.model, reason: "quota_exhausted", skipped: 0 });
    if (result.outcome === "auth_failed") deadKeys.set(call.keyVar, "auth_failed");
  }
  return { samples, stopped: [...stopped.values()] };
}

// --- the report -----------------------------------------------------------------------------------

const LatencySchema = z.strictObject({
  n: z.number().int().min(0),
  p50: z.number().nullable(),
  p95: z.number().nullable(),
  p99: z.number().nullable(),
  max: z.number().nullable(),
});

export const ResultRowSchema = z.strictObject({
  lang: LangCodeSchema,
  model: ModelIdSchema,
  position: z.number().int().min(1),
  /** Calls made. */
  attempts: z.number().int().min(0),
  ok: z.number().int().min(0),
  /** Failed attempts of the model: empty or wrong-script answers, timeouts and errors. */
  failures: z.number().int().min(0),
  failures_by_kind: z.strictObject({ empty: z.number().int(), wrong_script: z.number().int(), timeout: z.number().int(), error: z.number().int() }),
  /** The key's limits, not the model's: not counted as failures, and not latency samples. */
  rate_limited: z.number().int().min(0),
  quota_exhausted: z.number().int().min(0),
  /** Over the calls the model answered (ok, empty or wrong script), in ms; nearest-rank percentiles. */
  latency_ms: LatencySchema,
  usage: z.strictObject({ calls: z.number().int().min(0), input_tokens: z.number().int().min(0), output_tokens: z.number().int().min(0), calls_without_token_counts: z.number().int().min(0) }),
});
export type ResultRow = z.infer<typeof ResultRowSchema>;

export const FlaggedSchema = z.strictObject({
  lang: LangCodeSchema,
  model: ModelIdSchema,
  failures: z.number().int(),
  attempts: z.number().int(),
  action: z.string(),
});
export type Flagged = z.infer<typeof FlaggedSchema>;

export const ReportSchema = z.strictObject({
  schema: z.literal(REPORT_SCHEMA),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  started_at: z.string(),
  finished_at: z.string(),
  /** True when every planned call was made (no model stopped). */
  complete: z.boolean(),
  code_path: z.strictObject({
    adapter: z.string(),
    prompt: z.string(),
    temperature: z.number(),
    max_output_tokens: z.number().int().min(1),
    call_timeout_ms: z.number().int().min(1),
    output_check: z.string(),
  }),
  texts: z.strictObject({ file: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/), ids: z.array(z.string()) }),
  repetitions: z.number().int().min(1),
  routes: z.partialRecord(LangCodeSchema, z.array(ModelIdSchema)),
  /** Env var names only, never keys. */
  key_vars: z.array(z.string()),
  percentile_method: z.literal("nearest-rank"),
  spend_events: z.string(),
  planned_calls: z.number().int().min(0),
  stopped: z.array(z.strictObject({ key_var: z.string(), model: ModelIdSchema, reason: z.enum(["quota_exhausted", "auth_failed", "ceiling"]), skipped: z.number().int().min(0) })),
  results: z.array(ResultRowSchema),
  /** Route positions that failed more than 2 in 60 attempts: the launch-readiness checklist lists them. */
  failures_over_threshold: z.array(FlaggedSchema),
  samples: z.array(SampleSchema),
});
export type LatencyReport = z.infer<typeof ReportSchema>;

/** Rows per (language, model), in route order; latency over answered calls only. */
export function summarise(samples: readonly Sample[], routes: Routes): ResultRow[] {
  const groups = new Map<string, Sample[]>();
  for (const s of samples) {
    const key = `${s.lang}|${s.model}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const langOrder = Object.keys(routes);
  const rows = [...groups.values()].map((group): ResultRow => {
    const { lang, model, position } = group[0]!;
    const count = (o: Outcome) => group.filter((s) => s.outcome === o).length;
    const times = group.filter((s) => ANSWERED.includes(s.outcome)).map((s) => s.ms);
    return {
      lang,
      model,
      position,
      attempts: group.length,
      ok: count("ok"),
      failures: group.filter((s) => MODEL_FAILURES.includes(s.outcome)).length,
      failures_by_kind: { empty: count("empty"), wrong_script: count("wrong_script"), timeout: count("timeout"), error: count("error") },
      rate_limited: count("rate_limited"),
      quota_exhausted: count("quota_exhausted"),
      latency_ms: {
        n: times.length,
        p50: percentile(times, 50),
        p95: percentile(times, 95),
        p99: percentile(times, 99),
        max: times.length ? Math.max(...times) : null,
      },
      usage: {
        calls: group.length,
        input_tokens: group.reduce((n, s) => n + (s.input_tokens ?? 0), 0),
        output_tokens: group.reduce((n, s) => n + (s.output_tokens ?? 0), 0),
        calls_without_token_counts: group.filter((s) => s.input_tokens === null && s.output_tokens === null).length,
      },
    };
  });
  const rank = (lang: string) => (langOrder.indexOf(lang) === -1 ? Number.MAX_SAFE_INTEGER : langOrder.indexOf(lang));
  return rows.sort((a, b) => rank(a.lang) - rank(b.lang) || a.lang.localeCompare(b.lang) || a.position - b.position);
}

export const FAILURE_ACTION = "reorder the route or accept fallback";

/**
 * Route positions that failed more than 2 of 60 attempts (S04.01), i.e. more than 1 in 30 of the attempts the key's
 * limits did not cut short. With a full run that is exactly "more than 2 of 60".
 */
export function failuresOverThreshold(rows: readonly ResultRow[]): Flagged[] {
  return rows
    .map((r) => ({ r, scored: r.attempts - r.rate_limited - r.quota_exhausted }))
    .filter(({ r, scored }) => scored > 0 && r.failures * 60 > 2 * scored)
    .map(({ r, scored }) => ({ lang: r.lang, model: r.model, failures: r.failures, attempts: scored, action: FAILURE_ACTION }));
}

/** The launch-readiness checklist lines for the flagged route positions. */
export function checklistLines(flagged: readonly Flagged[]): string[] {
  return flagged.map((f) => `- [ ] Translation: ${f.model} failed ${f.failures} of ${f.attempts} attempts for ${f.lang}; action: ${f.action}.`);
}

export interface ReportMeta {
  date: string;
  startedAt: string;
  finishedAt: string;
  maxOutputTokens: number;
  callTimeoutMs: number;
  textsSha256: string;
  textIds: string[];
  repetitions: number;
  routes: Routes;
  plannedCalls: number;
}

export const CODE_PATH = {
  adapter: "src/modules/translation/adapters/cohereTranslator.ts (cohereTranslator, no retries)",
  prompt:
    "systemPrompt('en', lang): the module's generic translate prompt from S03.05; S04.02 had not defined an alert prompt when this was measured",
  temperature: 0,
};
export const SPEND_EVENTS_NOTE =
  "not recorded: this script writes no spend_event rows (the report's usage is the record); production records each call's time in spend_event";

export function buildReport(meta: ReportMeta, run: RunResult): LatencyReport {
  const results = summarise(run.samples, meta.routes);
  return ReportSchema.parse({
    schema: REPORT_SCHEMA,
    date: meta.date,
    started_at: meta.startedAt,
    finished_at: meta.finishedAt,
    complete: run.stopped.length === 0 && run.samples.length === meta.plannedCalls,
    code_path: { ...CODE_PATH, max_output_tokens: meta.maxOutputTokens, call_timeout_ms: meta.callTimeoutMs, output_check: OUTPUT_CHECK },
    texts: { file: TEXTS_FILE, sha256: meta.textsSha256, ids: meta.textIds },
    repetitions: meta.repetitions,
    routes: meta.routes,
    key_vars: [...new Set(run.samples.map((s) => s.key_var).concat(run.stopped.map((s) => s.key_var)))].sort(),
    percentile_method: "nearest-rank",
    spend_events: SPEND_EVENTS_NOTE,
    planned_calls: meta.plannedCalls,
    stopped: run.stopped,
    results,
    failures_over_threshold: failuresOverThreshold(results),
    samples: run.samples,
  });
}

export function parseReport(json: string): LatencyReport {
  return ReportSchema.parse(JSON.parse(json));
}

/**
 * One report from several partial runs of the same texts and code path (a model's allowance may run out before the
 * month does, so a full measurement can take more than one run, on more than one key). A call measured twice is an
 * error, not a bigger sample.
 */
export function mergeReports(reports: readonly LatencyReport[], date: string): LatencyReport {
  if (reports.length === 0) throw new Error("nothing to merge");
  const [first] = reports;
  for (const r of reports) {
    if (r.texts.sha256 !== first!.texts.sha256) throw new Error("the reports measured different texts files");
    const a = { ...r.code_path, call_timeout_ms: 0 };
    const b = { ...first!.code_path, call_timeout_ms: 0 };
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("the reports measured different code paths (prompt, answer length or check)");
  }
  const seen = new Set<string>();
  const samples: Sample[] = [];
  for (const r of reports) {
    for (const s of r.samples) {
      const key = sampleKey(s);
      if (seen.has(key)) throw new Error(`call ${key} appears in more than one report`);
      seen.add(key);
      samples.push(s);
    }
  }
  const routes: Routes = {};
  for (const r of reports) for (const [lang, models] of Object.entries(r.routes)) routes[lang as LangCode] ??= models;
  const order = (iso: (r: LatencyReport) => string) => reports.map(iso).sort();
  return buildReport(
    {
      date,
      startedAt: order((r) => r.started_at)[0]!,
      finishedAt: order((r) => r.finished_at).at(-1)!,
      maxOutputTokens: first!.code_path.max_output_tokens,
      callTimeoutMs: Math.max(...reports.map((r) => r.code_path.call_timeout_ms)),
      textsSha256: first!.texts.sha256,
      textIds: [...new Set(reports.flatMap((r) => r.texts.ids))],
      repetitions: Math.max(...reports.map((r) => r.repetitions)),
      routes,
      plannedCalls: reports.reduce((n, r) => n + r.planned_calls, 0),
    },
    { samples, stopped: reports.flatMap((r) => r.stopped) },
  );
}

export function formatResults(report: LatencyReport): string[] {
  const ms = (v: number | null) => (v === null ? "-" : String(Math.round(v)));
  return [
    `${"lang".padEnd(5)} ${"model".padEnd(32)} ${"n".padStart(4)} ${"p50".padStart(6)} ${"p95".padStart(6)} ${"p99".padStart(6)}  fail  429m  429  tokens in/out`,
    ...report.results.map(
      (r) =>
        `${r.lang.padEnd(5)} ${`${r.position}. ${r.model}`.padEnd(32)} ${String(r.latency_ms.n).padStart(4)} ${ms(r.latency_ms.p50).padStart(6)} ${ms(r.latency_ms.p95).padStart(6)} ${ms(r.latency_ms.p99).padStart(6)}  ${String(r.failures).padStart(4)}  ${String(r.quota_exhausted).padStart(4)}  ${String(r.rate_limited).padStart(3)}  ${r.usage.input_tokens}/${r.usage.output_tokens}`,
    ),
  ];
}

// --- the timeout rule -----------------------------------------------------------------------------

/** The rule in the E04 definitions (AR-14, AD-10). */
export const TIMEOUT_RULE = { p99Factor: 1.25, maxAttemptSeconds: 20, maxRouteDeadlineSeconds: 30 } as const;

/** p99 x 1.25 rounded up to the next whole second, before the cap. Integer arithmetic, so 1600 ms gives exactly 2 s. */
function uncappedSeconds(p99Ms: number): number {
  if (!Number.isFinite(p99Ms) || p99Ms < 0) throw new Error(`p99 must be a time in ms, not ${p99Ms}`);
  return Math.max(1, Math.ceil(Math.round(p99Ms * 1000 * TIMEOUT_RULE.p99Factor) / 1_000_000));
}

/** A route position's attempt timeout: its measured p99 x 1.25, rounded up to the next whole second (at least 1 s), at most 20 s. */
export function attemptTimeoutSeconds(p99Ms: number): number {
  return Math.min(TIMEOUT_RULE.maxAttemptSeconds, uncappedSeconds(p99Ms));
}

/** A language's route deadline: the sum of its attempt timeouts, at most 30 s. */
export function routeDeadlineSeconds(attemptTimeouts: readonly number[]): number {
  return Math.min(TIMEOUT_RULE.maxRouteDeadlineSeconds, attemptTimeouts.reduce((a, b) => a + b, 0));
}

export interface ProposedPosition {
  lang: LangCode;
  model: string;
  position: number;
  p99_ms: number;
  samples: number;
  attempt_timeout_s: number;
  /** The measured p99 x 1.25 was over 20 s: the model is slower than the rule allows. */
  capped: boolean;
}

export interface ProposedDeadline {
  lang: LangCode;
  sum_s: number;
  route_deadline_s: number;
  capped: boolean;
}

export interface TimeoutProposal {
  positions: ProposedPosition[];
  deadlines: ProposedDeadline[];
  /** Route positions with no answered call in the report: no timeout can be proposed for them. */
  missing: { lang: LangCode; model: string; position: number }[];
  /** Positions measured on fewer than 60 answered calls (the story's sample size): their p99 is rougher still. */
  thin: { lang: LangCode; model: string; samples: number }[];
}

export const FULL_SAMPLE = 60;

/** Per-(language, model) attempt timeouts and per-language route deadlines from a report, for the given routes. */
export function proposeTimeouts(report: Pick<LatencyReport, "results">, routes: Routes): TimeoutProposal {
  const positions: ProposedPosition[] = [];
  const deadlines: ProposedDeadline[] = [];
  const missing: TimeoutProposal["missing"] = [];
  const thin: TimeoutProposal["thin"] = [];
  for (const [lang, models] of Object.entries(routes) as [LangCode, readonly string[]][]) {
    const timeouts: number[] = [];
    models.forEach((model, index) => {
      const row = report.results.find((r) => r.lang === lang && r.model === model);
      const p99 = row?.latency_ms.p99 ?? null;
      if (!row || p99 === null) {
        missing.push({ lang, model, position: index + 1 });
        return;
      }
      const seconds = attemptTimeoutSeconds(p99);
      positions.push({ lang, model, position: index + 1, p99_ms: p99, samples: row.latency_ms.n, attempt_timeout_s: seconds, capped: uncappedSeconds(p99) > TIMEOUT_RULE.maxAttemptSeconds });
      if (row.latency_ms.n < FULL_SAMPLE) thin.push({ lang, model, samples: row.latency_ms.n });
      timeouts.push(seconds);
    });
    if (timeouts.length === models.length) {
      const sum = timeouts.reduce((a, b) => a + b, 0);
      deadlines.push({ lang, sum_s: sum, route_deadline_s: routeDeadlineSeconds(timeouts), capped: sum > TIMEOUT_RULE.maxRouteDeadlineSeconds });
    }
  }
  return { positions, deadlines, missing, thin };
}

export interface SqlShape {
  table: string;
  langColumn: string;
  modelColumn: string;
  timeoutColumn: string;
  unit: "ms" | "s";
}

/** S04.02's `translation_route`, as the scope split assumes it (one row per route position); confirm before use. */
export const DEFAULT_SQL_SHAPE: SqlShape = { table: "translation_route", langColumn: "lang", modelColumn: "model", timeoutColumn: "attempt_timeout_ms", unit: "ms" };

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(name)) throw new Error(`${name} is not a plain SQL identifier`);
  return name;
};
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * The body of the follow-up migration: one UPDATE of every measured route position's attempt timeout, which fails
 * unless it updated exactly that many rows (a route position missing from the table is a mistake, not a skip).
 */
export function timeoutsSql(proposal: TimeoutProposal, report: Pick<LatencyReport, "date">, shape: SqlShape = DEFAULT_SQL_SHAPE): string {
  if (proposal.positions.length === 0) throw new Error("no route position has a proposed timeout");
  const value = (s: number) => (shape.unit === "ms" ? s * 1000 : s);
  const rows = proposal.positions.map((p) => `      (${literal(p.lang)}, ${literal(p.model)}, ${value(p.attempt_timeout_s)})`).join(",\n");
  const deadlines = proposal.deadlines.map((d) => `--   ${d.lang.padEnd(4)} ${String(d.route_deadline_s).padStart(2)} s${d.capped ? ` (sum ${d.sum_s} s, capped at 30 s)` : ""}`).join("\n");
  return [
    `-- S04.01: attempt timeouts from data/translation-latency/${report.date}.json, by the rule in the E04 definitions:`,
    "-- each route position's measured p99 x 1.25, rounded up to the next second, at most 20 s.",
    "-- Route deadlines (the sum of a language's attempt timeouts, at most 30 s), computed from them:",
    deadlines,
    "-- Provisional: re-measured from production call times after the first two weeks of the pilot.",
    "DO $$",
    "DECLARE updated integer;",
    "BEGIN",
    `  UPDATE ${ident(shape.table)} AS r`,
    `     SET ${ident(shape.timeoutColumn)} = v.timeout`,
    "    FROM (VALUES",
    rows,
    "    ) AS v(lang, model, timeout)",
    `   WHERE r.${ident(shape.langColumn)} = v.lang AND r.${ident(shape.modelColumn)} = v.model;`,
    "  GET DIAGNOSTICS updated = ROW_COUNT;",
    `  IF updated <> ${proposal.positions.length} THEN`,
    `    RAISE EXCEPTION 'expected to set % route positions, set %', ${proposal.positions.length}, updated;`,
    "  END IF;",
    "END $$;",
    "",
  ].join("\n");
}

/** The table for the spine: the rule and the values. */
export function timeoutsMarkdown(proposal: TimeoutProposal, report: Pick<LatencyReport, "date">): string[] {
  const deadline = new Map(proposal.deadlines.map((d) => [d.lang, d]));
  return [
    `Measured ${report.date} (data/translation-latency/${report.date}.json). Attempt timeout = p99 x 1.25, rounded up to the next second, at most 20 s; route deadline = sum of the language's attempt timeouts, at most 30 s.`,
    "",
    "| Language | Position | Model | p99 (ms) | Samples | Attempt timeout (s) | Route deadline (s) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...proposal.positions.map((p) => {
      const d = deadline.get(p.lang);
      return `| ${p.lang} | ${p.position} | ${p.model} | ${Math.round(p.p99_ms)} | ${p.samples} | ${p.attempt_timeout_s}${p.capped ? " (capped)" : ""} | ${p.position === 1 && d ? d.route_deadline_s : ""} |`;
    }),
  ];
}
