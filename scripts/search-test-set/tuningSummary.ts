// scripts/search-test-set: what a tuning run prints and what its job summary holds (S03.07). The console text names question
// ids, provider ids and scores; the markdown summary (the Actions job summary) holds aggregates only: rates, counts, timings,
// usage and the suggested threshold. Neither holds a question's text.
import type { Metrics } from "@/contracts/searchTestSet";
import type { KindUsage, LegReport, ThresholdEffect, ThresholdSuggestion, TuningReport, TuningRow } from "@/contracts/searchTuning";

const pct = (r: { rate: number | null }) => (r.rate === null ? "-" : `${(r.rate * 100).toFixed(1)}%`);
const ms = (x: number | null) => (x === null ? "-" : String(x));
const num = (x: number | null) => (x === null ? "-" : x.toFixed(4));
const legName = (leg: LegReport) => (leg.translated_leg ? "on" : "off");

const modelCounts = (usage: KindUsage) =>
  Object.entries(usage.by_model)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, u]) => `${model} ${u.calls}`)
    .join(", ");

/** One line per kind: the calls, how many came to nothing and why, and the tokens the vendor reported. */
export function formatUsage(leg: LegReport): string[] {
  const line = (name: string, u: KindUsage) =>
    `  ${name}: ${u.calls} calls${u.calls > 0 ? ` (${modelCounts(u)})` : ""}; ${u.rate_limited} refused with 429, ${u.failed} failed, ${u.aborted} cancelled at the deadline; ${u.tokens} tokens reported${u.unreported_calls > 0 ? `, ${u.unreported_calls} answered calls without a count` : ""}`;
  return ["Vendor calls:", line("embedding", leg.usage.embedding), line("translation", leg.usage.translation)];
}

export function formatCounts(leg: LegReport): string[] {
  const c = leg.counts;
  const lines = [
    `${c.questions} questions: ${c.asked} asked, ${c.scored} scored (${c.hit} hit, ${c.miss} miss, ${c.no_clear_match} no_clear_match)`,
    `not scored: ${c.rate_limited} rate_limited, ${c.vendor_error} vendor_error, ${c.search_failed} search_failed; not run: ${c.not_run}`,
  ];
  if (leg.stopped !== null) {
    lines.push(`PARTIAL RESULTS: the run stopped (${leg.stopped === "max_calls" ? "the next question could pass --max-calls" : "the vendors kept failing"}); ${c.not_run} questions were not asked.`);
  }
  if (c.rate_limited + c.vendor_error + c.search_failed > 0) {
    lines.push("Questions that were not scored are left out of every rate below and are never counted as misses; run them again to complete the measurement.");
  }
  if (leg.translated_leg) {
    const t = leg.translated_leg_counts;
    lines.push(`translated-question leg: used ${t.used}, failed ${t.failed}, timed out ${t.timed_out}, not needed ${t.not_needed}; ${leg.fallback_translations} translated by a fallback model after the routed one was refused`);
  }
  return lines;
}

const effectLine = (label: string, e: ThresholdEffect, s: ThresholdSuggestion, ids: boolean) =>
  `${label} ${e.threshold}: ${e.hits_kept} hits kept, ${e.hits_lost} lost of ${s.hits_without_threshold}${ids && e.lost_ids.length > 0 ? ` (${e.lost_ids.join(", ")})` : ""}; ${e.no_match_clear} of ${s.no_match_questions} no-match questions clear; emergency flag on for ${e.emergency_on}`;

/**
 * The suggestion as lines; `ids` adds the questions whose hits would be lost (the console has them, the job summary does not).
 * `translatedLeg` is the run's setting: production searches with the leg on, so the suggestion of a leg-off run is the baseline.
 */
export function formatSuggestion(s: ThresholdSuggestion, ids = true, translatedLeg = true): string[] {
  const lines: string[] = [];
  if (s.threshold === null || s.at_suggested === null) {
    lines.push(`Suggested threshold: none (${s.reason})`);
  } else {
    lines.push(`Suggested threshold: ${s.threshold} (just above the highest no-match similarity ${num(s.highest_no_match)}, over ${s.no_match_questions} no-match questions)`);
    lines.push(`  ${effectLine("at", s.at_suggested, s, ids)}`);
    lines.push(
      s.hit_margin === null
        ? "  margin: it keeps no hit at all"
        : `  margin: ${num(s.hit_margin)} between the highest no-match similarity and the weakest hit it keeps (${num(s.lowest_kept_hit)}); any value from there up to that hit loses the same hits`,
    );
  }
  lines.push(`  ${effectLine("at the release's threshold", s.at_release, s, ids)}`);
  if (s.replay_mismatches > 0) lines.push(`  WARNING: ${s.replay_mismatches} questions ranked differently when replayed at the release's threshold: do not trust this suggestion`);
  if (!translatedLeg) lines.push("This run had the translated-question leg off; production searches with it on, so the leg-on run's suggestion is the one that applies there.");
  lines.push("This only suggests a value, on the tuning subset: the team chooses the threshold and sets it with SEARCH_THRESHOLD on a new release; it stays provisional until S03.08's evaluation run.");
  return lines;
}

/** Every question: id, language, intent, outcome, the highest similarity, the best expected provider's similarity, the legs, the time. Ids only. */
export function formatScores(rows: readonly TuningRow[]): string[] {
  const lines = ["", "Scores before the threshold (id, language, intent, outcome, highest similarity, best expected similarity, legs, ms)"];
  for (const r of rows) {
    const best = Object.values(r.expected_similarity);
    const expected = r.intent === "no_match" ? "n/a" : best.length > 0 ? num(Math.max(...best)) : "none";
    const legs = r.translated_leg === "used" ? "direct+translated" : r.legs_used.join("+") || "-";
    lines.push(`  ${r.id.padEnd(10)} ${r.lang.padEnd(8)} ${r.intent.padEnd(9)} ${r.outcome.padEnd(14)} max ${num(r.max_similarity)}  expected ${expected.padEnd(7)} ${legs.padEnd(17)} ${ms(r.ms)}`);
  }
  return lines;
}

/** The console text of one leg's run, after the generic table. */
export function formatLeg(leg: LegReport): string[] {
  return ["", `Translated-question leg ${legName(leg)}`, ...formatCounts(leg), ...formatUsage(leg), ...formatSuggestion(leg.threshold_suggestion, true, leg.translated_leg)];
}

// --- the job summary: aggregates only ---------------------------------------------------------------

function metricsRow(label: string, m: Metrics) {
  return `| ${label} | ${m.questions} | ${pct(m.top3)} | ${pct(m.top5)} | ${pct(m.no_match)} | ${pct(m.emergency)} | ${ms(m.time_ms.p50)} | ${ms(m.time_ms.p95)} |`;
}

/** A short markdown summary of the whole run: aggregates only, no question text, no question or provider ids. */
export function markdownSummary(report: TuningReport): string[] {
  const lines = [`Release ${report.release}, ${report.model}, release threshold ${report.release_threshold}; ${report.calls_made} vendor calls made (cap ${report.max_calls}).`, ""];
  for (const leg of [report.legs.off, report.legs.on]) {
    if (!leg) continue;
    const c = leg.counts;
    lines.push(`### Translated-question leg ${legName(leg)}`, "");
    lines.push(`${c.questions} questions: ${c.scored} scored (${c.hit} hit, ${c.miss} miss, ${c.no_clear_match} no clear match); not scored: ${c.rate_limited} rate limited, ${c.vendor_error} vendor errors, ${c.search_failed} search failed; not run: ${c.not_run}.`);
    if (leg.stopped !== null) lines.push("", `**Partial results:** the run stopped (${leg.stopped === "max_calls" ? "call cap" : "vendor failures"}).`);
    lines.push("", "| Language | Questions | Hit top 3 | Hit top 5 | No match | Emergency | p50 ms | p95 ms |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const [lang, m] of Object.entries(leg.aggregates.by_language)) lines.push(metricsRow(lang, m));
    lines.push(metricsRow("all", leg.aggregates.overall));
    const o = leg.aggregates.overall;
    lines.push("", `No-match accuracy ${pct(o.no_match)} (${o.no_match.hits} of ${o.no_match.of}), emergency accuracy ${pct(o.emergency)} (${o.emergency.hits} of ${o.emergency.of}), false 911 ${pct(o.false_emergency_rate)}.`);
    if (leg.translated_leg) {
      const t = leg.translated_leg_counts;
      lines.push(`Translated-question leg: used ${t.used} (${leg.fallback_translations} by a fallback model), failed ${t.failed}, timed out ${t.timed_out}, not needed ${t.not_needed}.`);
    }
    const u = leg.usage;
    lines.push(
      `Vendor calls: ${u.embedding.calls} embedding (${modelCounts(u.embedding) || "none"}), ${u.translation.calls} translation (${modelCounts(u.translation) || "none"}); ${u.embedding.rate_limited + u.translation.rate_limited} refused with 429, ${u.embedding.failed + u.translation.failed} failed otherwise.`,
    );
    lines.push("", ...formatSuggestion(leg.threshold_suggestion, false, leg.translated_leg).map((l) => (l.startsWith("  ") ? `  - ${l.trim()}` : `- ${l}`)), "");
  }
  return lines;
}
