import { describe, expect, it } from "vitest";
import { assertSmallNumbersHidden } from "./measureExport";
import { MEASURE_SECTIONS, SPEND_SECTIONS, measureLines, type LeftOut, type MeasureLine, type MeasuresContext } from "./measureLines";
import { DRILL, DRILL_ENTRY, REAL, REAL_CORRECTION, REAL_ENTRY, REHEARSAL, REHEARSAL_ENTRY, REHEARSAL_FINAL, sampleInput as input } from "./measuresFixtures";
import { shownCount } from "./smallNumbers";

// Every Section 9 measure as the export's lines (S09.05): the small-number rule on what the export adds up itself, drills apart, the alerts sent for a rehearsal
// left out of every measure about alerts, and spend and cost per alert only in the Admin and Director edition (AD-4).

const leftOut = (alerts: string[] = [REHEARSAL], entries: string[] = [REHEARSAL_ENTRY, REHEARSAL_FINAL]): LeftOut => ({ listed: 1, notFound: 0, alertIds: new Set(alerts), entryIds: new Set(entries) });
const context = (over: Partial<MeasuresContext> = {}): MeasuresContext => ({ asOf: "2026-10-06", edition: "director", week: "2026-09-28", leftOut: leftOut(), ...over });
const find = (lines: MeasureLine[], match: Partial<MeasureLine>) => lines.filter((line) => Object.entries(match).every(([key, value]) => line[key as keyof MeasureLine] === value));
const one = (lines: MeasureLine[], match: Partial<MeasureLine>) => {
  const found = find(lines, match);
  expect(found, JSON.stringify(match)).toHaveLength(1);
  return found[0];
};

describe("the lines", () => {
  it("cover every section of PRD section 9, in order, real measures before drills", () => {
    const lines = measureLines(input(), context());
    const sections = [...new Set(lines.filter((line) => !line.isDrill).map((line) => line.section))];
    expect(sections).toEqual(MEASURE_SECTIONS.filter((section) => section !== "drills"));
    const firstDrill = lines.findIndex((line) => line.isDrill);
    expect(firstDrill).toBeGreaterThan(0);
    expect(lines.slice(firstDrill).every((line) => line.isDrill)).toBe(true);
    expect(find(lines, { section: "drills" }).every((line) => line.isDrill)).toBe(true);
  });

  it("say the day, the edition, the week and what was left out", () => {
    const lines = measureLines(input(), context());
    expect(find(lines, { section: "about" }).map((line) => `${line.measure}=${line.value}`)).toEqual([
      "as_of=2026-10-06",
      "edition=director",
      "week=2026-09-28",
      "rehearsal_entries_listed=1",
      "rehearsal_entries_not_found=0",
      "rehearsal_alerts_left_out=1",
      "rehearsal_entries_left_out=2",
    ]);
  });

  it("hold no field that could carry a phone number, a subscriber id or a message body", () => {
    const lines = measureLines(input(), context());
    expect(Object.keys(lines[0]).sort()).toEqual(["alertId", "basis", "entryId", "isDrill", "key", "label", "measure", "period", "section", "split", "unit", "value"]);
  });
});

describe("the small-number rule", () => {
  it("hides a count of 1 to 4 by language and neighbourhood, and one more cell where the total would reveal it", () => {
    const lines = measureLines(input(), context());
    const installs = find(lines, { section: "installs", measure: "install", period: "week 2026-09-28" });
    expect(installs.map((line) => `${line.split}:${line.key ?? "all"}=${line.value}`)).toEqual([
      "total:all=42",
      "language:ur=fewer than 5",
      "language:fr=not shown",
      "language:en=30",
      "neighbourhood:FP=9",
      "neighbourhood:TP=33",
    ]);
    // A week with 2 map views in all: the total is hidden too.
    expect(one(lines, { section: "directory_use", measure: "map_view", period: "pilot to date", split: "total" }).value).toBe("fewer than 5");
  });

  it("does not show a percentage made from a count of 1 to 4", () => {
    const lines = measureLines(input(), context());
    expect(one(lines, { section: "search", measure: "no_clear_match_percent", period: "week 2026-09-28", split: "total" }).value).toBe("29");
    expect(one(lines, { section: "search", measure: "no_clear_match_percent", period: "week 2026-09-28", key: "ur" }).value).toBe("not shown");
    expect(one(lines, { section: "translation", measure: "fallback_percent", split: "language", key: "ur", isDrill: false }).value).toBe("not shown");
    expect(one(lines, { section: "translation", measure: "survey_understood_percent", split: "total" }).value).toBe("80");
    expect(one(lines, { section: "translation", measure: "survey_understood_percent", key: "fr" }).value).toBe("not shown");
    expect(one(lines, { section: "translation", measure: "survey_asked", key: "fr" }).value).toBe("fewer than 5");
  });

  it("passes on the figures the views already judged as they were shown", () => {
    const lines = measureLines(input(), context());
    expect(one(lines, { section: "subscribers", measure: "receiving_active", key: "ur" }).value).toBe("fewer than 5");
    expect(one(lines, { section: "cost_per_alert", measure: "text_cost", entryId: REAL_ENTRY, key: "ur" })).toMatchObject({ value: "not shown", basis: null });
  });

  it("hides the 90% time of an entry with 1 to 4 texts, and the round counts of a floor with 1 to 4", () => {
    const lines = measureLines(input(), context());
    expect(one(lines, { section: "timing", measure: "approval_to_90_percent_delivered_seconds", entryId: DRILL_ENTRY }).value).toBe("not shown");
    expect(one(lines, { section: "timing", measure: "texts_handed_off", entryId: DRILL_ENTRY }).value).toBe("fewer than 5");
    const requested = find(lines, { section: "checkins", measure: "requested", alertId: REAL });
    expect(requested.map((line) => `${line.split}:${line.key ?? "-"}=${line.value}`)).toEqual(["thread:-=8", "building:1000001=8", "floor:1000001 3=not shown", "floor:1000001 4=fewer than 5"]);
  });

  it("gives check-ins as one tree of totals, so no hidden count is the requests less the other outcomes", () => {
    // The round asked 8 (6 on floor 3, all checked on; 2 on floor 4, who need help). Outcomes by round, building or floor would give the 2 away as 8 - 6: they
    // are given for the pilot to date only, where the 6 is hidden for the 2.
    const lines = measureLines(input(), context());
    expect(find(lines, { section: "checkins" }).map((line) => `${line.measure} ${line.split}:${line.key ?? line.alertId ?? "-"}=${line.value}`)).toEqual([
      "requested total:-=8",
      "done total:-=not shown",
      "not_reached total:-=0",
      "needs_help total:-=fewer than 5",
      "withdrawn total:-=0",
      "unmarked total:-=0",
      "rounds_closed total:-=1",
      `requested thread:${REAL}=8`,
      "requested building:1000001=8",
      "requested floor:1000001 3=not shown",
      "requested floor:1000001 4=fewer than 5",
    ]);
    expect(find(lines, { section: "checkins" }).filter((line) => line.measure !== "requested" && line.split !== "total")).toEqual([]);
  });

  it("hides a floor where its own building's total would give it away", () => {
    // One round: building A asked 20 on floor 1 and 2 on floor 2; building B asked 5 on its floor 1. Across the round's floors the 5 is the smallest cell to
    // hide; but A's 22 less A's visible 20 would then still be 2. The floor hidden for A's 2 is A's own.
    const at = new Date("2026-10-05T20:00:00Z");
    const row = (rsn: string, floor: string, status: string, n: number) => ({ alertId: REAL, closedAt: at, rsn, nbhd: "TP", address: `${rsn} Sample Road`, floorId: `${rsn}-${floor}`, floorLabel: floor, floorOrder: Number(floor), status, n });
    const checkins = [row("A", "1", "requested", 20), row("A", "2", "requested", 2), row("B", "1", "requested", 5), row("A", "1", "done", 20), row("A", "2", "done", 2), row("B", "1", "done", 5)];
    const lines = find(measureLines({ ...input(), checkins }, context()), { section: "checkins", measure: "requested", alertId: REAL });
    expect(lines.map((line) => `${line.split}:${line.key ?? "-"}=${line.value}`)).toEqual(["thread:-=27", "building:A=22", "floor:A 1=not shown", "floor:A 2=fewer than 5", "building:B=5", "floor:B 1=5"]);
  });

  it("does not list the rounds when the pilot's check-ins are 1 to 4 in all, nor give their number, and calls a request no close tallied 'untallied'", () => {
    const at = new Date("2026-10-05T20:00:00Z");
    const row = (alertId: string, status: string, n: number) => ({ alertId, closedAt: at, rsn: "1000001", nbhd: "TP", address: "1 Leaside Park Dr", floorId: "f1", floorLabel: "3", floorOrder: 3, status, n });
    // Four rounds of one request each (listed, they would be 1 each), the last closed before its request was tallied.
    const checkins = ["a", "b", "c", "d"].flatMap((id, index) => [row(id, "requested", 1), ...(index < 3 ? [row(id, "done", 1)] : [])]);
    const lines = find(measureLines({ ...input(), checkins }, context()), { section: "checkins" });
    expect(lines.map((line) => `${line.measure}=${line.value}`)).toEqual(["requested=fewer than 5", "rounds_closed=fewer than 5"]);
    const bigger = ["a", "b"].flatMap((id) => [row(id, "requested", 6), ...(id === "a" ? [row(id, "done", 6)] : [])]);
    const untallied = find(measureLines({ ...input(), checkins: bigger }, context()), { section: "checkins", split: "total" });
    expect(untallied.map((line) => `${line.measure}=${line.value}`)).toEqual(["requested=12", "done=6", "not_reached=0", "needs_help=0", "withdrawn=0", "unmarked=0", "untallied=6", "rounds_closed=2"]);
    expect(() => measureLines({ ...input(), checkins: [row("a", "requested", 6), row("a", "done", 7)] }, context())).toThrow(/outcomes are more than their requests/);
  });

  it("leaves a language's 90% time of 1 to 4 texts out of its median", () => {
    const languageTimings = [
      { entryId: REAL_ENTRY, lang: "ur", isDrill: false, handedOff: 3, ninetyPercentSeconds: 40 },
      { entryId: REAL_CORRECTION, lang: "ur", isDrill: false, handedOff: 9, ninetyPercentSeconds: 70 },
    ];
    const lines = measureLines({ ...input(), languageTimings }, context());
    expect(one(lines, { section: "timing", measure: "approval_to_90_percent_delivered_seconds", split: "language", key: "ur" }).value).toBe("70");
  });

  it("lists no language, of searches or of translated entries, when their total is 1 to 4 (four languages listed of a total of 4 would be 1 each)", () => {
    const search = [
      { weekStart: "2026-09-28", lang: null, searches: 4, noClearMatch: 0, failed: 0, medianMs: 900 },
      ...["ur", "ps", "tl", "en"].map((lang) => ({ weekStart: "2026-09-28", lang, searches: 1, noClearMatch: 0, failed: 0, medianMs: 900 })),
    ];
    const translations = ["ur", "fr", "es"].map((lang, index) => ({ entryId: `real-${index}`, alertId: REAL, isDrill: false, lang, fellBack: false }));
    const lines = measureLines({ ...input(), search, translations }, context());
    expect(find(lines, { section: "search", period: "week 2026-09-28", split: "language" })).toEqual([]);
    expect(one(lines, { section: "search", measure: "searches", period: "week 2026-09-28", split: "total" }).value).toBe("fewer than 5");
    expect(find(lines, { section: "translation", isDrill: false, split: "language" }).filter((line) => !line.measure.startsWith("survey"))).toEqual([]);
  });

  it("writes no count of 1 to 4 anywhere but the Hub's own work", () => {
    expect(() => assertSmallNumbersHidden(measureLines(input(), context()))).not.toThrow();
  });
});

describe("the alerts sent for a rehearsal", () => {
  it("are left out of every measure about alerts: times, check-ins, translation, corrections, cost per alert", () => {
    const lines = measureLines(input(), context());
    expect(lines.filter((line) => line.alertId === REHEARSAL || line.entryId === REHEARSAL_ENTRY || line.entryId === REHEARSAL_FINAL)).toEqual([]);
    // Without them in: the median time to approval would count the rehearsal's 9000 s, and French would have a 90% time by language.
    expect(one(lines, { section: "timing", measure: "first_save_to_approval_seconds", split: "total", isDrill: false }).value).toBe("180");
    expect(find(lines, { section: "timing", measure: "approval_to_90_percent_delivered_seconds", split: "language", key: "fr" })).toEqual([]);
    expect(one(lines, { section: "translation", measure: "fell_back", split: "total", isDrill: false }).value).toBe("fewer than 5");
    expect(one(lines, { section: "corrections", measure: "finals_sent", isDrill: false }).value).toBe("0");
    expect(find(lines, { section: "checkins", measure: "requested", period: "pilot to date", key: "FP" })).toEqual([]);
  });

  it("are counted where none is listed", () => {
    const lines = measureLines(input(), context({ leftOut: leftOut([], []) }));
    expect(find(lines, { alertId: REHEARSAL }).length).toBeGreaterThan(0);
    expect(one(lines, { section: "corrections", measure: "finals_sent", isDrill: false }).value).toBe("1");
  });
});

describe("drills", () => {
  it("are on lines of their own and never added to real measures", () => {
    const lines = measureLines(input(), context());
    expect(one(lines, { section: "drills", measure: "drills_run" }).value).toBe("1");
    const drill = find(lines, { section: "drills", alertId: DRILL });
    expect(drill.map((line) => `${line.measure}=${line.value}`)).toEqual([
      "entries_approved=4",
      "texts_handed_off=12",
      "texts_delivered=not shown",
      "texts_not_delivered=fewer than 5",
      "texts_unknown=0",
      "texts_in_flight=0",
      "texts_not_sent=0",
    ]);
    expect(one(lines, { section: "timing", measure: "first_save_to_approval_seconds_entries", isDrill: false }).value).toBe("2");
    expect(one(lines, { section: "timing", measure: "first_save_to_approval_seconds_entries", isDrill: true }).value).toBe("1");
    expect(one(lines, { section: "translation", measure: "entries_translated", split: "total", isDrill: true }).value).toBe("fewer than 5");
  });
});

describe("the editions (AD-4)", () => {
  it("give the Admin and Director edition spend against the budget, actual and estimate labelled, and an unknown price as unknown", () => {
    const lines = measureLines(input(), context());
    expect(one(lines, { section: "spend", measure: "budget" }).value).toBe("1000.00");
    expect(one(lines, { section: "spend", measure: "total_counted", period: "pilot to date" })).toMatchObject({ value: "12.34", basis: "incomplete: leaves out use whose price is unknown" });
    expect(one(lines, { section: "spend", measure: "sms_actual", period: "pilot to date" })).toMatchObject({ value: "10.00", basis: "actual" });
    expect(find(lines, { section: "spend", measure: "sms_pending_reconciliation" })[0]).toMatchObject({ value: "2.34", basis: "estimate (not_run)" });
    expect(one(lines, { section: "spend", measure: "translation_price_unknown", period: "pilot to date" })).toMatchObject({ value: "unknown", basis: "price unknown" });
    expect(one(lines, { section: "cost_per_alert", measure: "text_cost", entryId: REAL_ENTRY, split: "entry" })).toMatchObject({ value: "0.80", basis: "estimate" });
    expect(one(lines, { section: "cost_per_alert", measure: "translation_cost", entryId: REAL_ENTRY })).toMatchObject({ value: "unknown", basis: "price unknown" });
  });

  it("leave spend and cost per alert out of the Coordinator edition, whatever was read", () => {
    const lines = measureLines(input(), context({ edition: "coordinator" }));
    expect(lines.filter((line) => SPEND_SECTIONS.includes(line.section))).toEqual([]);
    expect(lines.filter((line) => line.unit === "CAD")).toEqual([]);
    expect(one(lines, { section: "about", measure: "edition" }).value).toBe("coordinator");
    // The rest is the same as the other edition's.
    const director = measureLines(input(), context()).filter((line) => !SPEND_SECTIONS.includes(line.section) && line.measure !== "edition");
    expect(lines.filter((line) => line.measure !== "edition")).toEqual(director);
  });
});

describe("the other measures", () => {
  it("give the times per entry and their medians, and 'not reached' with the delivered share", () => {
    const lines = measureLines(input(), context());
    expect(find(lines, { section: "timing", entryId: REAL_ENTRY }).map((line) => `${line.measure}=${line.value}`)).toEqual([
      "kind=ack",
      "reported_to_first_ack_seconds=600",
      "first_save_to_approval_seconds=240",
      "texts_handed_off=40",
      "approval_to_first_hand_off_seconds=3",
      "approval_to_90_percent_delivered_seconds=95",
    ]);
    expect(find(lines, { section: "timing", entryId: REAL_CORRECTION }).slice(-2).map((line) => `${line.measure}=${line.value}`)).toEqual([
      "approval_to_90_percent_delivered_seconds=not reached",
      "delivered_percent=60",
    ]);
    expect(one(lines, { section: "timing", measure: "approval_to_90_percent_delivered_seconds", split: "language", key: "en" }).value).toBe("90");
    expect(one(lines, { section: "timing", measure: "approval_to_90_percent_delivered_seconds", split: "language", key: "ur" }).value).toBe("none yet");
  });

  it("give coverage by neighbourhood with the share of floors covered", () => {
    const lines = measureLines(input(), context());
    expect(find(lines, { section: "coverage", measure: "buildings_covered" }).map((line) => `${line.key ?? "all"}=${line.value}`)).toEqual([
      "all=8",
      "FP=fewer than 5",
      "TP=not shown",
    ]);
    expect(one(lines, { section: "coverage", measure: "floors_covered_percent", split: "total" }).value).toBe("10");
    expect(one(lines, { section: "coverage", measure: "floors_covered_percent", key: "FP" }).value).toBe("6");
  });

  it("say when the daily count has not run and when no survey was recorded", () => {
    const lines = measureLines({ ...input(), subscribers: null, survey: { byLanguage: [], from: null, to: null } }, context());
    expect(one(lines, { section: "subscribers" }).value).toBe("The daily count has not run yet.");
    expect(one(lines, { section: "translation", measure: "survey" }).value).toBe("No survey result has been recorded yet.");
  });

  it("make every count of the Hub's own work a whole number and every other count pass the rule", () => {
    for (const line of measureLines(input(), context()).filter((entry) => entry.unit === "count")) {
      expect(line.value === "fewer than 5" || line.value === "not shown" || /^\d+$/.test(line.value), `${line.measure}=${line.value}`).toBe(true);
    }
    expect(shownCount(3).shown).toBe("fewer than 5");
  });
});
