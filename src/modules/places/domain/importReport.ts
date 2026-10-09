import { PILOT_AREAS, formatProblem, type ImportPlan, type PlanProblem } from "./register";

/** The numbers an import run reports (application/importBuildings.ts ImportCounts, as plain numbers). */
export type ReportCounts = Record<string, number>;

/**
 * The seed's report, one line each: what the register held, what was (or would be) loaded, and every
 * warning and failing row. `done` is the outcome of a real run; a dry run or a refused one gives none.
 */
export function formatImportReport(plan: ImportPlan, done?: { counts: ReportCounts; warnings: PlanProblem[] }): string[] {
  const { counts } = plan;
  const lines: string[] = [];
  const areas = PILOT_AREAS.map((area) => `${area.fsa} ${counts.pilotRowsByFsa[area.fsa]}`).join(", ");
  lines.push(`Register: ${counts.features} rows; ${counts.pilotRows} in the pilot's postal areas (${areas}); ${counts.outsidePilot} elsewhere, not loaded.`);
  if (counts.merged > 0) lines.push(`Merge file: ${counts.merged} registration${counts.merged === 1 ? "" : "s"} folded into another building.`);
  if (plan.failures.length === 0) lines.push(`${done ? "Loaded" : "Would load"}: ${plan.buildings.length} buildings.`);
  if (done) {
    const c = done.counts;
    lines.push(`Buildings: ${c.buildings_inserted} added, ${c.buildings_updated} with changed facts, ${c.buildings_unchanged} unchanged, ${c.buildings_restored} back in the register.`);
    lines.push(`Floors created for new buildings: ${c.floors_created}. Flagged "not in latest register" by this run: ${c.buildings_flagged}.`);
    if (c.buildings_hidden > 0 || c.buildings_unmerged > 0) {
      lines.push(`Merged into another building by this run (kept, left out of every list): ${c.buildings_hidden ?? 0}. Listed again (their merge line is gone): ${c.buildings_unmerged ?? 0}.`);
    }
  }
  const warnings = done ? done.warnings : plan.warnings;
  if (warnings.length > 0) {
    lines.push(`Warnings (${warnings.length}):`);
    for (const warning of warnings) lines.push(`  - ${formatProblem(warning)}`);
  }
  if (plan.failures.length > 0) {
    lines.push(`Failures (${plan.failures.length}): nothing was imported.`);
    for (const failure of plan.failures) lines.push(`  - ${formatProblem(failure)}`);
  }
  return lines;
}
