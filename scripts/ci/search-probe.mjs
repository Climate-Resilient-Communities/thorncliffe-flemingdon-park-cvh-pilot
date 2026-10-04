// One real English search against a deployed app, for the production smoke check (e2e/smoke.spec.ts imports these helpers;
// Playwright loads this file as CommonJS, so it has no `import.meta` and no top-level await) and for the daily latency probe
// (search-latency.mjs, run by .github/workflows/search-latency.yml). Each search spends one Cohere call, so both are behind the
// repository variable SMOKE_SEARCH ("off" skips; anything else, or unset, is on). No secret is needed: POST /api/search is
// public. Nothing here sends anything but the fixed question below.

/** The fixed question: a plain need the directory answers (the question is never logged by the app). */
export const SEARCH_QUESTION = "Where can I find a food bank?";
export const DEFAULT_BUDGET_MS = 3000;

/** True unless the variable says "off" (any case, spaces ignored). */
export const searchSmokeEnabled = (value) =>
  (value ?? "").trim().toLowerCase() !== "off";

/**
 * The `total` phase of a Server-Timing header, in ms, or null when the header is missing or has no usable total.
 * @param {string | null | undefined} header
 * @returns {number | null}
 */
export function serverTimingTotal(header) {
  for (const part of (header ?? "").split(",")) {
    const [name, ...params] = part.trim().split(";");
    if (name?.trim() !== "total") continue;
    for (const param of params) {
      const [key, value] = param.trim().split("=");
      const ms = Number(value);
      if (
        key === "dur" &&
        value !== undefined &&
        value.trim() !== "" &&
        Number.isFinite(ms) &&
        ms >= 0
      )
        return ms;
    }
  }
  return null;
}

/**
 * The latency budget from SEARCH_LATENCY_BUDGET_MS: a positive number of ms; unset or empty is the default.
 * @param {string | undefined} value
 * @returns {number}
 */
export function latencyBudgetMs(value) {
  if (value === undefined || value.trim() === "") return DEFAULT_BUDGET_MS;
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0)
    throw new Error(
      `SEARCH_LATENCY_BUDGET_MS must be a positive number of milliseconds, not "${value}".`,
    );
  return ms;
}

/**
 * What is wrong with an answer to the fixed question, or null when it is a good one: 200, status ok, a result.
 * @param {number} httpStatus
 * @param {unknown} body
 * @returns {string | null}
 */
export function answerProblem(httpStatus, body) {
  if (httpStatus !== 200) return `answered HTTP ${httpStatus}, not 200`;
  const answer = /** @type {{ status?: unknown, results?: unknown } | null} */ (
    body
  );
  if (answer?.status !== "ok")
    return `answered status "${String(answer?.status)}", not "ok"`;
  if (!Array.isArray(answer.results) || answer.results.length < 1)
    return "answered no result";
  return null;
}

/** The job summary lines for one search: the response time and the Server-Timing total. */
export function timingLines(title, { responseMs, totalMs }, budgetMs) {
  const budget = budgetMs === undefined ? "" : ` (budget ${budgetMs} ms)`;
  return [
    `## ${title}`,
    "",
    "| Measure | Milliseconds |",
    "|---|---|",
    `| Response time, as the client saw it | ${Math.round(responseMs)}${budget} |`,
    `| Server-Timing total | ${totalMs === null ? "not reported" : Math.round(totalMs) + budget} |`,
    "",
  ];
}

/** POSTs the fixed question in English; the response time includes the connection. */
export async function askSearch(
  baseUrl,
  {
    fetchImpl = fetch,
    now = () => performance.now(),
    headers = {},
    timeoutMs = 15000,
  } = {},
) {
  const url = new URL("/api/search", baseUrl);
  const started = now();
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ q: SEARCH_QUESTION, lang: "en" }),
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const responseMs = now() - started;
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // answerProblem reports it
  }
  return {
    httpStatus: response.status,
    body,
    responseMs,
    totalMs: serverTimingTotal(response.headers.get("server-timing")),
  };
}

/**
 * The daily probe: the problems found (empty when the search answered well and inside the budget) and the summary lines.
 * @returns {Promise<{ problems: string[], lines: string[] }>}
 */
export async function runProbe(env, deps = {}) {
  const base = env.PRODUCTION_URL ?? "";
  if (!base.startsWith("https://")) {
    return {
      problems: [
        "The repository variable PRODUCTION_URL is missing or is not a full https:// URL.",
      ],
      lines: [],
    };
  }
  const budget = latencyBudgetMs(env.SEARCH_LATENCY_BUDGET_MS);
  let result;
  try {
    result = await askSearch(base, {
      timeoutMs: Math.max(budget * 3, 10000),
      ...deps,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      problems: [
        `Search did not answer: ${reason} (the request is cut off after ${Math.max(budget * 3, 10000)} ms).`,
      ],
      lines: [],
    };
  }
  const problems = [];
  const bad = answerProblem(result.httpStatus, result.body);
  if (bad) problems.push(`Search ${bad}.`);
  if (result.responseMs > budget)
    problems.push(
      `Search took ${Math.round(result.responseMs)} ms to answer, over the ${budget} ms budget.`,
    );
  if (result.totalMs !== null && result.totalMs > budget)
    problems.push(
      `Search reported a Server-Timing total of ${Math.round(result.totalMs)} ms, over the ${budget} ms budget.`,
    );
  return {
    problems,
    lines: timingLines("Search latency probe", result, budget),
  };
}
