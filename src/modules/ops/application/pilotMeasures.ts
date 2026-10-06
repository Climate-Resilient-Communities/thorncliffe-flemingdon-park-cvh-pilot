// The pilot measures export (S09.05, FR-M1 to FR-M5, D-8, NFR-N9, AD-4): every Section 9 measure, read in one read-only snapshot and written as a CSV and a
// printable page for the week-8 go / no-go review. scripts/export-measures runs it (an Admin, daily and for the review); nothing here writes to the database.
//
// ops reads its own views (the measures store) and messaging's correction reach (an edge of the spine's diagram); the measures of modules ops may not import
// come through ports the composition root wires (AD-2): subscriptions' subscriber measures, spend's cost per alert and spend view, and coverage (identity's
// rule over places' buildings). Spend and cost per alert are asked for only in the Admin and Director edition (AD-4), so the Coordinator edition never reads
// them. The alerts sent for a rehearsal (docs/procedures/rehearsals.md) are found here from their entry ids and left out by the lines (measureLines).
import { readCorrectionReach } from "../../messaging";
import type { Db, DbExecutor } from "../../../platform/db";
import { measuresStore } from "../adapters/measuresStore";
import { measuresCsv, measuresHtml } from "../domain/measureExport";
import type { Survey } from "../domain/measureFiles";
import {
  measureLines,
  torontoDay,
  type CoverageInput,
  type LeftOut,
  type MeasureEdition,
  type MeasureLine,
  type MeasuresInput,
  type SpendInput,
  type SubscriberDayInput,
} from "../domain/measureLines";
import { isWeekStart, lastFullWeek } from "../domain/weeklyReview";

/** Every correction, withdrawal and final: the reach report's list is the latest N, and the export wants them all. */
const ALL_ENTRIES = 100_000;

/** The measures of the modules ops may not import, each read through the snapshot's executor. */
export interface MeasurePorts {
  /** subscriptions' latest day of subscriber measures (S07.10); null before the daily job has run. */
  subscribers(executor: DbExecutor): Promise<SubscriberDayInput | null>;
  /** spend's cost of every alert entry and the vendor's months (S07.10). Asked only for the Admin and Director edition. */
  alertCost(executor: DbExecutor): Promise<NonNullable<MeasuresInput["cost"]>>;
  /** spend's spend view (S07.08) as of `now`, against the budget. Asked only for the Admin and Director edition. */
  spend(executor: DbExecutor, now: Date): Promise<SpendInput>;
  /** Pilot buildings and floors with an ambassador, by neighbourhood. */
  coverage(executor: DbExecutor): Promise<CoverageInput[]>;
}

export interface PilotMeasuresRequest {
  now: Date;
  edition: MeasureEdition;
  /** The Monday (Toronto) of the week read for installs, directory, map and search use; default the last complete week. */
  week?: string;
  /** The alert entry ids listed in docs/procedures/rehearsals.md, "Alerts sent for a rehearsal". */
  rehearsalEntryIds: readonly string[];
  /** docs/procedures/survey-results.csv, read. */
  survey: Survey;
}

export interface PilotMeasures {
  /** The Toronto day the export is as of. */
  asOf: string;
  week: string;
  edition: MeasureEdition;
  lines: MeasureLine[];
  leftOut: LeftOut;
}

/** Reads every measure in one read-only, repeatable-read snapshot and makes the export's lines. */
export async function readPilotMeasures(db: Db, request: PilotMeasuresRequest, ports: MeasurePorts): Promise<PilotMeasures> {
  const week = request.week ?? lastFullWeek(request.now);
  if (!isWeekStart(week)) throw new Error("pilot measures: a week is given by its Monday, written YYYY-MM-DD");
  const asOf = torontoDay(request.now);
  const withSpend = request.edition === "director";
  return db.transaction(
    async (tx) => {
      const threads = await measuresStore.threadsOf(tx, request.rehearsalEntryIds);
      const leftOut: LeftOut = {
        listed: request.rehearsalEntryIds.length,
        notFound: request.rehearsalEntryIds.filter((id) => !threads.found.has(id)).length,
        alertIds: threads.alertIds,
        entryIds: threads.entryIds,
      };
      const input: MeasuresInput = {
        subscribers: await ports.subscribers(tx),
        usage: await measuresStore.usage(tx),
        search: await measuresStore.search(tx, week),
        approvals: await measuresStore.approvals(tx),
        deliveries: await measuresStore.deliveries(tx),
        languageTimings: await measuresStore.languageTimings(tx),
        checkins: await measuresStore.checkins(tx),
        translations: await measuresStore.translations(tx),
        survey: request.survey,
        corrections: await readCorrectionReach(tx, ALL_ENTRIES),
        drills: await measuresStore.drills(tx),
        cost: withSpend ? await ports.alertCost(tx) : null,
        spend: withSpend ? await ports.spend(tx, request.now) : null,
        coverage: await ports.coverage(tx),
      };
      return { asOf, week, edition: request.edition, leftOut, lines: measureLines(input, { asOf, edition: request.edition, week, leftOut }) };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export interface PilotMeasuresFiles extends PilotMeasures {
  csv: string;
  html: string;
}

/** The export's two files: the CSV and the printable page, each refusing to write a count the small-number rule should have hidden. */
export async function pilotMeasuresExport(db: Db, request: PilotMeasuresRequest, ports: MeasurePorts): Promise<PilotMeasuresFiles> {
  const measures = await readPilotMeasures(db, request, ports);
  return {
    ...measures,
    csv: measuresCsv(measures.lines, { asOf: measures.asOf, edition: measures.edition }),
    html: measuresHtml(measures.lines, { asOf: measures.asOf, edition: measures.edition, writtenAt: request.now }),
  };
}
