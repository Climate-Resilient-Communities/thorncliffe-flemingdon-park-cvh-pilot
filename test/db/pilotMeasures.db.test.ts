// The pilot measures export against a real database (S09.05, FR-M1 to FR-M5, D-8, NFR-N9, AD-4): the views of 20261006200000_pilot_measures.sql beside the
// earlier measure views, read as the app's own role (cvh_app_login) in one read-only snapshot, and scripts/export-measures's two files.
//  - every Section 9 measure is in the export: subscribers and installs, times, check-ins, directory, map and search use, translation fallbacks and the survey,
//    corrections and their reach, drills apart, cost per alert and total spend (the Admin and Director edition only), coverage;
//  - the small-number rule on counts and percentages (no count of 1 to 4 written anywhere but the Hub's own work, and none that the other figures give
//    away: the check-ins' outcomes are not given where the requests less the other outcomes would be one), drills on lines of their own after every real line
//    and in a section of their own on the page;
//  - a text resent after it failed (S09.02) counts once, with its original, in the delivery times;
//  - the alerts listed in the rehearsal log are left out of every measure about alerts, and the export says how many;
//  - the Coordinator edition has no spend and no cost per alert; spend is against the CAD 1,000 budget with an unknown price shown as unknown;
//  - no phone number, subscriber id, message body or staff name in either file, and the export changes nothing (a read-only transaction);
//  - the views are readable by the app's role only.
// Every number is fictional.
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { coverageByNeighbourhood, measurePorts, runExportMeasures } from "../../scripts/ops/export-measures";
import { migrate } from "../../scripts/db/migrate.mjs";
import { lastFullWeek, readPilotMeasures, SURVEY_HEADER, UNPROTECTED_COUNTS } from "../../src/modules/ops";
import { recordSmsEstimate, recordSpendEvent } from "../../src/modules/spend";
import { createDb, type Db } from "../../src/platform/db";
import { deliveryFixtures, FAKE_NUMBER, type SeededEntry } from "./deliveryFixtures";
import { connect, ROOT, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let appUrl: string;
let fx: ReturnType<typeof deliveryFixtures>;
const made: { neighbourhoods: string[]; searchFrom: number } = { neighbourhoods: [], searchFrom: 0 };

const WEEK = lastFullWeek(new Date());
const RSN_A = "9105501";
const RSN_B = "9105502";
const FLOORS = { a1: randomUUID(), a2: randomUUID(), a3: randomUUID(), a4: randomUUID(), a5: randomUUID(), a6: randomUUID(), b1: randomUUID() };
const BODY = "Power is out at 12 Sample Road. Verified by the Hub. Reply STOP";
const SUBSCRIBER = randomUUID();
const SUBSCRIBER_PHONE = "+14165550199";
const MEASURE_DAY = "2026-10-04";

let real: SeededEntry;
let rehearsal: SeededEntry;
let drill: SeededEntry;
let ambassador: { id: string };
const files: Record<string, string> = {};
const output: string[] = [];
let auditBefore = 0;
let opsBefore = 0;

/** An instant `days` days and `hours` hours after the week's Monday 00:00 in Toronto. */
async function at(days: number, hours = 0): Promise<Date> {
  const [row] = await owner`select (((${WEEK}::date + ${days}::int * interval '1 day' + ${hours}::int * interval '1 hour')::timestamp) at time zone 'America/Toronto') as t`;
  return new Date(row.t);
}

/** An approved entry of a fresh thread, approved at `approvedAt`, first saved 4 minutes before and reported 10 minutes before. */
async function approvedEntry(approvedAt: Date, isDrill = false): Promise<SeededEntry> {
  const entry = await fx.entry("approved", { isDrill });
  await owner.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    await tx`update alert set reported_at = ${new Date(approvedAt.getTime() - 600_000)}, created_at = ${new Date(approvedAt.getTime() - 300_000)} where id = ${entry.alertId}`;
    await tx`update alert_entry set approved_at = ${approvedAt}, created_at = ${new Date(approvedAt.getTime() - 240_000)} where id = ${entry.entryId}`;
  });
  return entry;
}

/** `count` delivered alert texts of an entry in a language, handed off 3 s after the approval and delivered a minute later. */
async function delivered(entry: SeededEntry, approvedAt: Date, count: number, lang: string, options: { roster?: string; recipientId?: string } = {}) {
  for (let index = 0; index < count; index += 1) {
    const id = randomUUID();
    const handedOff = new Date(approvedAt.getTime() + 3_000);
    const completed = new Date(approvedAt.getTime() + 60_000 + index * 1_000);
    await owner.begin(async (tx) => {
      await tx.unsafe("set local session_replication_role = replica");
      await tx`insert into delivery (id, kind, recipient_kind, recipient_id, entry_id, created_by_module, purpose, lang, body, segments, cost_estimate_cents, idempotency_key,
                                     state, attempts, claimed_at, claimed_by, handed_off_at, submitted_at, provider_message_id, completed_at, created_at, updated_at, due_at)
               values (${id}, 'alert', ${options.roster ? "roster" : "subscriber"}, ${options.roster ?? options.recipientId ?? randomUUID()}, ${entry.entryId}, 'alerting', null, ${lang}, ${BODY},
                       1, 2, ${`alert:${entry.entryId}:${id}`}, 'delivered', 1, ${handedOff}, 'worker-1', ${handedOff}, ${handedOff}, ${`SM${randomBytes(16).toString("hex")}`},
                       ${completed}, ${approvedAt}, ${completed}, ${approvedAt})`;
    });
    await recordSmsEstimate(app, { deliveryId: id, entryId: entry.entryId, lang, isDrill: options.roster !== undefined, segments: 1, costCents: 2, purpose: "alert" });
  }
}

async function translation(entry: SeededEntry, lang: string, status: "translated" | "fallback_en") {
  await owner.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    await tx`insert into alert_entry_translation (entry_id, lang, body, machine, model, status, source_hash)
             values (${entry.entryId}, ${lang}, ${BODY}, ${status === "translated"}, ${status === "translated" ? "m1" : null}, ${status}, ${"a".repeat(64)})`;
  });
}

/** The CSV's rows as objects. */
function rowsOf(csv: string): Record<string, string>[] {
  const [header, ...rows] = csv.trimEnd().split("\r\n");
  const columns = header.split(",");
  return rows.map((row) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < row.length; index += 1) {
      const char = row[index];
      if (quoted && char === '"' && row[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) {
        cells.push(cell);
        cell = "";
      } else cell += char;
    }
    cells.push(cell);
    return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""]));
  });
}

const csv = (edition: string) => files[Object.keys(files).find((name) => name.endsWith(`-${edition}.csv`)) ?? ""] ?? "";
const html = (edition: string) => files[Object.keys(files).find((name) => name.endsWith(`-${edition}.html`)) ?? ""] ?? "";
const where = (rows: Record<string, string>[], match: Record<string, string>) => rows.filter((row) => Object.entries(match).every(([key, value]) => row[key] === value));

async function exportEdition(edition: string, rehearsalIds: string[], survey: string): Promise<number> {
  const log = ["## Alerts sent for a rehearsal", "", "| Alert entry id | Date | Rehearsal |", "| --- | --- | --- |", ...rehearsalIds.map((id) => `| ${id} | 2026-10-01 | resend |`), "| | | |", "", "## Log", ""].join("\n");
  return runExportMeasures(["--edition", edition, "--week", WEEK, "--out-dir", "out"], {
    env: { DATABASE_URL: appUrl, SMS_MODE: "log", PUBLIC_BASE_URL: "http://localhost:3000" },
    now: () => new Date(),
    out: (line) => output.push(line),
    error: (line) => output.push(`ERROR ${line}`),
    root: ROOT,
    read: (file) => (file.endsWith("rehearsals.md") ? log : survey),
    write: (file, content) => {
      files[file] = content;
    },
    connect: () => ({ db: app, close: async () => {} }),
  });
}

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appUrl = url.href;
  appSql = postgres(url.href, { max: 2, onnotice: () => {} });
  app = createDb(url.href);
  fx = deliveryFixtures(owner);
  for (const [id, name, fsa] of [
    ["TP", "Thorncliffe Park", "M4H"],
    ["FP", "Flemingdon Park", "M3C"],
  ]) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${name}, ${fsa})`;
      made.neighbourhoods.push(id);
    }
  }
  [{ max: made.searchFrom }] = await owner`select coalesce(max(id), 0)::int as max from search_log`;
  await clearOwn();

  // Places and coverage: building A (6 floors, an active ambassador on all of them), building B (1 floor, nobody).
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${RSN_A}, 'TP', '12 Sample Road', 43.7, -79.34, now()), (${RSN_B}, 'FP', '40 Sample Drive', 43.71, -79.33, now())`;
  await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOORS.a1}, ${RSN_A}, '1', 1, true), (${FLOORS.a2}, ${RSN_A}, '2', 2, true), (${FLOORS.a3}, ${RSN_A}, '3', 3, true),
              (${FLOORS.a4}, ${RSN_A}, '4', 4, true), (${FLOORS.a5}, ${RSN_A}, '5', 5, true), (${FLOORS.a6}, ${RSN_A}, '6', 6, true), (${FLOORS.b1}, ${RSN_B}, '1', 1, true)`;
  ambassador = await fx.staff("ambassador");
  const admin = await fx.staff("admin");
  await owner`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${ambassador.id}, ${RSN_A}, true, ${admin.id})`;

  // A subscriber whose number, id and texts must appear nowhere in the export.
  await owner`insert into subscriber (id, phone, lang, neighbourhood_id, consent_version, started_by) values (${SUBSCRIBER}, ${SUBSCRIBER_PHONE}, 'en', 'TP', '2026-10-02.1', 'web')`;
  await owner`insert into subscriber_measure (day, measure, lang, nbhd, n) values (${MEASURE_DAY}::date, 'receiving_active', 'en', 'TP', 40), (${MEASURE_DAY}::date, 'receiving_active', 'ur', 'TP', 3)`;

  // A real alert: 12 English texts and 3 Urdu, delivered; Urdu fell back to English; translated at a price not known.
  const realAt = await at(1, 10);
  real = await approvedEntry(realAt);
  await delivered(real, realAt, 1, "en", { recipientId: SUBSCRIBER });
  await delivered(real, realAt, 11, "en");
  await delivered(real, realAt, 3, "ur");
  await translation(real, "ur", "fallback_en");
  await translation(real, "fr", "translated");
  await recordSpendEvent(app, { kind: "translate", purpose: "alert", model: "command-a-translate", calls: 2, tokens: 3_000, pricePerMillionTokensCad: null, entryId: real.entryId, isDrill: false } as never);

  // A real alert sent for a rehearsal (listed in the rehearsal log): 6 texts, a fallback, a check-in round, a cost.
  const rehearsalAt = await at(0, 9);
  rehearsal = await approvedEntry(rehearsalAt);
  await delivered(rehearsal, rehearsalAt, 6, "fr");
  await translation(rehearsal, "ur", "fallback_en");

  // A drill: 3 texts to the roster.
  const drillAt = await at(2, 9);
  drill = await approvedEntry(drillAt, true);
  const member = await fx.rosterMember();
  await delivered(drill, drillAt, 3, "en", { roster: member });

  // The real alert's round, closed: floor 1 asked 6 and all were checked on; floor 2 asked 2 and they need help. The rehearsal's round too.
  const closedAt = await at(3, 12);
  await owner.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    for (const entry of [real, rehearsal]) await tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = ${closedAt} where id = ${entry.alertId}`;
  });
  await owner`insert into checkin_tally (alert_id, rsn, floor_id, status, n) values
              (${real.alertId}, ${RSN_A}, ${FLOORS.a1}, 'requested', 6), (${real.alertId}, ${RSN_A}, ${FLOORS.a1}, 'done', 6),
              (${real.alertId}, ${RSN_A}, ${FLOORS.a2}, 'requested', 2), (${real.alertId}, ${RSN_A}, ${FLOORS.a2}, 'needs_help', 2),
              (${rehearsal.alertId}, ${RSN_B}, ${FLOORS.b1}, 'requested', 7), (${rehearsal.alertId}, ${RSN_B}, ${FLOORS.b1}, 'done', 7)`;

  // Installs and map views of the week; searches of the week.
  const day = (await owner`select (${WEEK}::date + 1)::text as day`)[0].day as string;
  await owner`insert into usage_count (day, evt, lang, nbhd, n) values (${day}::date, 'install', 'en', 'TP', 30), (${day}::date, 'install', 'ur', 'TP', 3), (${day}::date, 'install', 'fr', 'FP', 9), (${day}::date, 'map_view', 'en', '', 2)
              on conflict (day, evt, lang, nbhd) do update set n = excluded.n`;
  const searchAt = await at(1, 12);
  for (let index = 0; index < 6; index += 1) await owner`insert into search_log (at, lang, query_lang, ms, result_count, status, top_score) values (${searchAt}, 'en', 'en', 800, 3, 'ok', 0.8)`;
  for (let index = 0; index < 2; index += 1) await owner`insert into search_log (at, lang, query_lang, ms, result_count, status, top_score) values (${searchAt}, 'ur', 'ur', 1200, 0, 'no_clear_match', 0.2)`;

  [{ max: auditBefore }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  [{ max: opsBefore }] = await owner`select coalesce(max(id), 0)::int as max from ops_event`;
  const survey = [SURVEY_HEADER, "2026-10-01,ur,12,9", "2026-10-02,fr,3,3"].join("\n");
  expect(await exportEdition("director", [rehearsal.entryId, randomUUID()], survey)).toBe(0);
  expect(await exportEdition("coordinator", [rehearsal.entryId, randomUUID()], survey)).toBe(0);
});

/** The places, round counts and subscriber this file makes, removed before it starts (after an interrupted run) and when it ends. */
async function clearOwn() {
  await owner`delete from checkin_tally where rsn in (${RSN_A}, ${RSN_B})`;
  await owner`delete from ambassador_assignment_floor where rsn in (${RSN_A}, ${RSN_B})`;
  await owner`delete from ambassador_assignment where rsn in (${RSN_A}, ${RSN_B})`;
  await owner`delete from building_floor where rsn in (${RSN_A}, ${RSN_B})`;
  await owner`delete from building where rsn in (${RSN_A}, ${RSN_B})`;
  await owner`delete from subscriber where phone = ${SUBSCRIBER_PHONE}`;
  await owner`delete from subscriber_measure where day = ${MEASURE_DAY}::date`;
  await owner`delete from usage_count where day = (${WEEK}::date + 1)`;
  await owner`delete from spend_event`;
}

afterAll(async () => {
  await clearOwn();
  // The translations of an approved entry are frozen (a trigger): they are removed with the triggers off.
  await owner.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    for (const entry of [real, rehearsal, drill]) if (entry) await tx`delete from alert_entry_translation where entry_id = ${entry.entryId}`;
  });
  await fx.cleanup();
  await owner`delete from search_log where id > ${made.searchFrom}`;
  for (const id of made.neighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

describe("scripts/export-measures", () => {
  it("writes a CSV and a printable page for each edition, named by the day and the edition, and says what it left out", () => {
    expect(Object.keys(files).sort()).toEqual(
      ["coordinator.csv", "coordinator.html", "director.csv", "director.html"].map((suffix) => expect.stringMatching(new RegExp(`^out/pilot-measures-\\d{4}-\\d{2}-\\d{2}-${suffix.replace(".", "\\.")}$`))),
    );
    expect(output.filter((line) => line.startsWith("ERROR"))).toEqual([]);
    expect(output).toContain("Left out: 1 alert sent for a rehearsal (2 listed in the rehearsal log, 1 not found).");
    expect(html("director")).toMatch(/As of \d{4}-\d{2}-\d{2} \(Toronto\)/);
    for (const row of rowsOf(csv("director"))) expect(row.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("gives every Section 9 measure, by language and neighbourhood where it applies", () => {
    const rows = rowsOf(csv("director"));
    const sections = new Set(rows.map((row) => row.section));
    for (const section of ["subscribers", "installs", "timing", "checkins", "directory_use", "search", "translation", "corrections", "drills", "cost_per_alert", "spend", "coverage"]) {
      expect(sections.has(section), section).toBe(true);
    }
    expect(where(rows, { section: "subscribers", measure: "receiving_active", split: "total" })[0]).toMatchObject({ period: MEASURE_DAY, value: "43" });
    expect(where(rows, { section: "installs", period: `week ${WEEK}`, split: "language" }).map((row) => `${row.key}=${row.value}`)).toEqual(["ur=fewer than 5", "fr=not shown", "en=30"]);
    expect(where(rows, { section: "installs", period: `week ${WEEK}`, split: "neighbourhood" }).map((row) => `${row.key}=${row.value}`)).toEqual(["FP=9", "TP=33"]);
    expect(where(rows, { section: "search", measure: "searches", period: `week ${WEEK}`, split: "total" })[0].value).toBe("8");
    expect(where(rows, { section: "search", measure: "median_answer_ms", period: `week ${WEEK}`, split: "language", key: "en" })[0].value).toBe("800");
    expect(where(rows, { section: "translation", measure: "survey_asked", split: "total" })[0].value).toBe("15");
    expect(where(rows, { section: "coverage", measure: "floors_covered", split: "neighbourhood" }).length).toBeGreaterThan(0);
  });

  it("gives the times of an alert: report to acknowledgement, first save to approval, approval to hand-off and to 90% delivered", () => {
    const rows = where(rowsOf(csv("director")), { section: "timing", entry_id: real.entryId });
    expect(rows.map((row) => `${row.measure}=${row.value}`)).toEqual([
      "kind=ack",
      "reported_to_first_ack_seconds=600",
      "first_save_to_approval_seconds=240",
      "texts_handed_off=15",
      "approval_to_first_hand_off_seconds=3",
      // 90% of 15 texts is the 14th delivered (they were delivered 60 to 70 seconds after the approval): 69 seconds.
      "approval_to_90_percent_delivered_seconds=69",
    ]);
  });

  it("gives the round counts per thread, building and floor after the thread closed, with no identifiers", () => {
    const rows = where(rowsOf(csv("director")), { section: "checkins", alert_id: real.alertId });
    expect(where(rows, { measure: "requested" }).map((row) => `${row.split}:${row.key}=${row.value}`)).toEqual([
      "thread:=8",
      `building:${RSN_A}=8`,
      `floor:${RSN_A} 1=not shown`,
      `floor:${RSN_A} 2=fewer than 5`,
    ]);
    // How the requests ended is given for the pilot to date only.
    expect(rows.filter((row) => row.measure !== "requested")).toEqual([]);
  });

  it("gives no check-in count that the requests less the other outcomes would give away", () => {
    // 8 asked, 6 checked on, 2 need help: shown as they are, the 2 would be 8 - 6 - 0 - 0 - 0.
    const rows = where(rowsOf(csv("director")), { section: "checkins", period: "pilot to date", split: "total" });
    expect(rows.map((row) => `${row.measure}=${row.value}`)).toEqual([
      "requested=8",
      "done=not shown",
      "not_reached=0",
      "needs_help=fewer than 5",
      "withdrawn=0",
      "unmarked=0",
      "rounds_closed=1",
    ]);
  });

  it("applies the small-number rule to every count and percentage it writes", () => {
    for (const edition of ["director", "coordinator"]) {
      for (const row of rowsOf(csv(edition)).filter((entry) => entry.unit === "count" && !UNPROTECTED_COUNTS.includes(entry.measure))) {
        expect(/^[1-4]$/.test(row.value), `${row.section} ${row.measure} ${row.key} = ${row.value}`).toBe(false);
      }
    }
    const rows = rowsOf(csv("director"));
    // 2 entries' languages translated (Urdu, which fell back, and French): fewer than 5 in all, so no language is listed and no rate is given.
    expect(where(rows, { section: "translation", measure: "entries_translated", split: "total", is_drill: "false" })[0].value).toBe("fewer than 5");
    expect(where(rows, { section: "translation", measure: "fallback_percent", split: "total", is_drill: "false" })[0].value).toBe("not shown");
    expect(where(rows, { section: "translation", measure: "entries_translated", split: "language", is_drill: "false" })).toEqual([]);
    expect(where(rows, { section: "translation", measure: "survey_understood_percent", key: "fr" })[0].value).toBe("not shown");
  });

  it("keeps drills apart: on lines of their own after every real line, and in a section of their own on the page", () => {
    const rows = rowsOf(csv("director"));
    const first = rows.findIndex((row) => row.is_drill === "true");
    expect(first).toBeGreaterThan(0);
    expect(rows.slice(first).every((row) => row.is_drill === "true")).toBe(true);
    expect(where(rows, { section: "drills", measure: "drills_run" })[0].value).toBe("1");
    expect(where(rows, { section: "timing", entry_id: drill.entryId, measure: "texts_handed_off" })[0]).toMatchObject({ is_drill: "true", value: "fewer than 5" });
    expect(where(rows, { section: "timing", measure: "first_save_to_approval_seconds_entries", is_drill: "false" })[0].value).toBe("1");
    const page = html("director");
    expect(page.indexOf("<h2>Drills, reported apart</h2>")).toBeGreaterThan(page.indexOf('id="coverage"'));
  });

  it("leaves the alerts listed in the rehearsal log out of every measure about alerts", () => {
    for (const edition of ["director", "coordinator"]) {
      expect(csv(edition)).not.toContain(rehearsal.entryId);
      expect(csv(edition)).not.toContain(rehearsal.alertId);
      expect(html(edition)).not.toContain(rehearsal.entryId);
    }
    const rows = rowsOf(csv("director"));
    expect(where(rows, { section: "about", measure: "rehearsal_alerts_left_out" })[0].value).toBe("1");
    expect(where(rows, { section: "about", measure: "rehearsal_entries_not_found" })[0].value).toBe("1");
    // The rehearsal's round of 7 in Flemingdon Park and its French texts are nowhere.
    expect(where(rows, { section: "checkins", measure: "requested", period: "pilot to date" })[0].value).toBe("8");
    expect(where(rows, { section: "checkins", key: RSN_B })).toEqual([]);
    expect(where(rows, { section: "cost_per_alert", key: "fr" })).toEqual([]);
    expect(where(rows, { section: "timing", split: "entry", entry_id: real.entryId }).length).toBeGreaterThan(0);
  });

  it("gives spend and cost per alert in the Admin and Director edition only, against the CAD 1,000 budget, an unknown price as unknown", () => {
    const director = rowsOf(csv("director"));
    expect(where(director, { section: "spend", measure: "budget" })[0]).toMatchObject({ value: "1000.00", unit: "CAD" });
    expect(where(director, { section: "spend", measure: "translation_price_unknown", period: "pilot to date" })[0]).toMatchObject({ value: "unknown", basis: "price unknown" });
    expect(where(director, { section: "spend", measure: "sms_pending_reconciliation" }).every((row) => row.basis.startsWith("estimate"))).toBe(true);
    // Its Urdu texts (3) are hidden, and English (12) with them, so the entry's total cost is not shown either (20261007030000): with the count it would give them away.
    expect(where(director, { section: "cost_per_alert", measure: "text_cost", entry_id: real.entryId, split: "entry" })[0]).toMatchObject({ value: "not shown", basis: "" });
    expect(where(director, { section: "cost_per_alert", measure: "translation_cost", entry_id: real.entryId })[0]).toMatchObject({ value: "unknown", basis: "price unknown" });

    const coordinator = rowsOf(csv("coordinator"));
    expect(coordinator.filter((row) => row.section === "spend" || row.section === "cost_per_alert" || row.unit === "CAD")).toEqual([]);
    expect(html("coordinator")).not.toContain("CAD ");
    expect(html("coordinator")).toContain("Coordinator edition: spend and cost per alert are left out.");
    // The rest is the same in both editions.
    const same = (rows: Record<string, string>[]) => rows.filter((row) => !["spend", "cost_per_alert"].includes(row.section) && row.measure !== "edition").map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => column !== "edition")));
    expect(same(coordinator)).toEqual(same(director));
  });

  it("holds no phone number, subscriber id, message body or staff name, and changed nothing", async () => {
    for (const content of Object.values(files)) {
      for (const secret of [SUBSCRIBER_PHONE, FAKE_NUMBER, SUBSCRIBER, BODY, "Sample Road. Verified", "dl_", "test@example.org"]) expect(content).not.toContain(secret);
      expect(content).not.toMatch(/\+1\d{10}/);
    }
    expect((await owner`select coalesce(max(id), 0)::int as max from audit_event`)[0].max).toBe(auditBefore);
    expect((await owner`select coalesce(max(id), 0)::int as max from ops_event`)[0].max).toBe(opsBefore);
  });
});

describe("the delivery times", () => {
  it("count a text resent after it failed once, with its original: the resends add no text and do not move the time to 90% delivered", async () => {
    // 20 texts: 18 delivered 60 to 77 seconds after the approval, 2 failed; then both resent and delivered an hour later.
    const approvedAt = await at(4, 10);
    const entry = await approvedEntry(approvedAt);
    await delivered(entry, approvedAt, 18, "en");
    const roots = [randomUUID(), randomUUID()];
    const insert = (id: string, state: string, offsetSeconds: number, resendOf: string | null) =>
      owner.begin(async (tx) => {
        await tx.unsafe("set local session_replication_role = replica");
        const handedOff = new Date(approvedAt.getTime() + offsetSeconds * 1000);
        const completed = new Date(handedOff.getTime() + 60_000);
        await tx`insert into delivery (id, kind, recipient_kind, recipient_id, entry_id, created_by_module, purpose, lang, body, segments, cost_estimate_cents, idempotency_key,
                                       state, attempts, claimed_at, claimed_by, handed_off_at, submitted_at, provider_message_id, completed_at, created_at, updated_at, due_at,
                                       resend_of, resend_n)
                 values (${id}, 'alert', 'subscriber', ${randomUUID()}, ${entry.entryId}, 'alerting', null, 'en', ${BODY}, 1, 2,
                         ${resendOf === null ? `alert:${entry.entryId}:${id}` : `resend:${resendOf}:1`}, ${state}, 1, ${handedOff}, 'worker-1', ${handedOff}, ${handedOff},
                         ${`SM${randomBytes(16).toString("hex")}`}, ${completed}, ${handedOff}, ${completed}, ${handedOff}, ${resendOf}, ${resendOf === null ? null : 1})`;
      });
    for (const root of roots) await insert(root, "failed", 3, null);
    const read = async () =>
      (await appSql`select lang, handed_off, delivered, ninety_percent_seconds::int as ninety from alert_delivery_timing where entry_id = ${entry.entryId} order by lang nulls first`).map(
        (row) => `${row.lang ?? "all"}: ${row.handed_off} handed off, ${row.delivered} delivered, 90% at ${row.ninety ?? "not reached"}`,
      );
    expect(await read()).toEqual(["all: 20 handed off, 18 delivered, 90% at 77", "en: 20 handed off, 18 delivered, 90% at 77"]);
    for (const root of roots) await insert(randomUUID(), "delivered", 3_600, root);
    expect(await read()).toEqual(["all: 20 handed off, 20 delivered, 90% at 77", "en: 20 handed off, 20 delivered, 90% at 77"]);
  });
});

describe("the measures snapshot", () => {
  it("is read in a read-only transaction: a port that tries to write is refused", async () => {
    const ports = measurePorts(app, { spendPilotBudgetCents: 100_000, spendTokenEstimateCadPerMillion: null });
    const writing = { ...ports, coverage: async (executor: Parameters<typeof ports.coverage>[0]) => {
      await executor.execute(sql`insert into usage_count (day, evt, lang, nbhd, n) values ('2026-01-05', 'install', 'en', '', 1)`);
      return [];
    } };
    await expect(readPilotMeasures(app, { now: new Date(), edition: "coordinator", rehearsalEntryIds: [], survey: { byLanguage: [], from: null, to: null } }, writing)).rejects.toThrow();
  });

  it("counts coverage by identity's rule: an active ambassador covers every floor of the building, a suspended one nothing", async () => {
    const coverage = async () => (await coverageByNeighbourhood(app, app)).filter((row) => row.nbhd === "TP" || row.nbhd === "FP");
    const tp = (await coverage()).find((row) => row.nbhd === "TP");
    expect(tp?.floorsCovered).toBeGreaterThanOrEqual(6);
    const before = tp?.floorsCovered ?? 0;
    await owner`update staff_account set status = 'suspended' where id = ${ambassador.id}`;
    try {
      expect((await coverage()).find((row) => row.nbhd === "TP")?.floorsCovered).toBe(before - 6);
    } finally {
      await owner`update staff_account set status = 'active' where id = ${ambassador.id}`;
    }
  });
});

describe("the views", () => {
  it("are read by the app's role and by no client role", async () => {
    for (const view of ["usage_week_count", "search_measure", "alert_delivery_timing", "alert_translation_outcome", "checkin_round_count", "drill_measure"]) {
      await expect(appSql.unsafe(`select * from ${view} limit 1`)).resolves.toBeDefined();
      const [grants] = await owner`select has_table_privilege('anon', ${view}, 'select') as anon, has_table_privilege('authenticated', ${view}, 'select') as authenticated`;
      expect(grants, view).toEqual({ anon: false, authenticated: false });
    }
  });

  it("hold no column that could carry a phone number, a recipient id or a message body", async () => {
    const columns = await owner`select table_name, column_name from information_schema.columns
                               where table_name in ('usage_week_count', 'search_measure', 'alert_delivery_timing', 'alert_translation_outcome', 'checkin_round_count', 'drill_measure')`;
    const names = columns.map((row) => String(row.column_name));
    for (const forbidden of ["phone", "recipient_id", "subscriber_id", "body", "staff_id", "round_ref"]) expect(names).not.toContain(forbidden);
  });
});
