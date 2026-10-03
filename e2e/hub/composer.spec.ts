import { expect, test, type Page } from "@playwright/test";
import { composerScreen, type ComposerMode } from "../../src/app/staff/alerts/composer/view";
import { logScreen } from "../../src/app/staff/alerts/log/view";
import type { EntryState } from "../../src/modules/alerting";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S04.05: "Log a disruption" (O-11), the acknowledgement composer (O-12) and the alert composer (O-02) inside the Hub shell, at 390 and
// 1280 px: the empty log form and a refused one, a draft (acknowledgement and alert) with its text message preview and the fifteen
// languages waiting, a submit that is running with the languages settled so far, a refusal and the clock-change question, a submitted
// entry with languages that fell back and a possible duplicate, and one with every language translated. The views are built by the app's
// own view functions from sample buildings; the screens are the app's own LogBody and ComposerBody with actions that do nothing. The
// behaviour is asserted in src/app/staff/alerts/**/*.test.ts, test/db/alertSubmit.db.test.ts and e2e/staff/alerts.spec.ts; the boundaries
// of the layout are in e2e/layout/composer.spec.ts; these pictures show what it looks like. The staff screens are English in the pilot.
const brand = hubBrand();

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const OTHER = "01900000-0000-7000-8000-00000000e178";
const KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";
const NOW = new Date("2026-10-04T14:00:00.000Z");
const FIRST_REPORT = new Date("2026-10-04T13:30:00.000Z");

const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;
const plan = (rsn: string, address: string, floors: number, neighbourhoodId = "TP", neighbourhoodName = "Thorncliffe Park"): BuildingFloorPlan => ({
  rsn,
  address,
  neighbourhoodId,
  neighbourhoodName,
  floors: ["G", ...Array.from({ length: floors }, (_, index) => String(index + 1))].map((label, index) => ({ id: floorId(rsn, index), label, sortOrder: index })),
});

const PLANS: BuildingFloorPlan[] = [
  plan("4154146", "4 Milepost Pl", 6),
  plan("4154159", "85-95 Thorncliffe Park Dr", 12),
  plan("4154763", "5 Dufresne Crt", 4, "FP", "Flemingdon Park"),
  plan("4244530", "35 St Dennis Dr", 0, "FP", "Flemingdon Park"),
];

const ACK_TEXT = "The elevator at 4 Milepost Pl is out of service. We are finding out more. More information to come.";

function stateOf(options: { kind?: "ack" | "update"; entry?: Record<string, unknown>; attempt?: Record<string, unknown> | null; translations?: EntryState["translations"]; types?: string[] } = {}): EntryState {
  const types = options.types ?? ["elevator"];
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: FIRST_REPORT, status: "open" },
    entry: {
      id: ENTRY,
      alertId: ALERT,
      kind: options.kind ?? "ack",
      status: "draft",
      authorId: "01900000-0000-7000-8000-0000000000c1",
      editorIds: [],
      content: {
        text: ACK_TEXT,
        types,
        audience: {
          scope: "buildings",
          buildings: [
            { rsn: "4154146", floors: [floorId("4154146", 3), floorId("4154146", 4), floorId("4154146", 5)] },
            { rsn: "4154159", floors: null },
          ],
          groups: ["families", "seniors"],
          types,
        },
        phase: "problem",
        validUntil: new Date("2026-10-05T14:00:00.000Z"),
      },
      version: 0,
      contentHash: null,
      submittedAt: null,
      returnedFor: null,
      returnedNote: null,
      approvedBy: null,
      approvedAt: null,
      webPublishedAt: null,
      possibleDuplicateOf: null,
      ...options.entry,
    } as EntryState["entry"],
    attempt:
      options.attempt === undefined || options.attempt === null
        ? null
        : ({ key: KEY, kind: "submit", state: "running", outcome: null, startedAt: NOW, finishedAt: null, budgetMs: 35000, progress: {}, resultVersion: null, resultHash: null, ...options.attempt } as NonNullable<EntryState["attempt"]>),
    translations: options.translations ?? [],
  };
}

const LANGS = ["ur", "ps", "tl", "prs", "gu", "ta", "el", "sk", "bn", "hi", "pa", "zh", "es", "fr"] as const;
/** Every language translated, and Traditional Chinese converted from the Mandarin. */
const ALL_TRANSLATED: EntryState["translations"] = [...LANGS.map((lang) => ({ lang, status: "translated", machine: true })), { lang: "zh-Hant", status: "script_converted", machine: true }];
/** Urdu and Pashto fell back to English; the rest were translated. */
const SOME_FELL_BACK: EntryState["translations"] = ALL_TRANSLATED.map((row) => (row.lang === "ur" || row.lang === "ps" ? { ...row, status: "fallback_en", machine: false } : row));

const SMS = { body: `Thorncliffe Flemingdon Hub: ${ACK_TEXT}\nhttps://cvh.example/a/abcd2345\nFor an emergency, call 911.`, encoding: "gsm7" as const, segments: 2 };

const screenOf = (mode: ComposerMode, state: EntryState, options: { preview?: boolean; saved?: boolean } = {}) =>
  composerScreen({ mode, state, plans: PLANS, preview: options.preview === false ? null : { sms: SMS, nineOneOneFirst: false }, saved: options.saved ?? false, now: NOW });

/** The viewport is as tall as the page, so the picture shows all of it, with the sticky actions at its end. */
async function fitToPage(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height });
}

async function openComposer(page: Page, width: number, props: Omit<Parameters<typeof mount<"ComposerFixture">>[2], "texts" | "brand">) {
  await page.setViewportSize({ width, height: 800 });
  await mount(page, "ComposerFixture", { texts: REAL_TEXTS, brand, ...props });
  await fitToPage(page, width);
}

async function openLog(page: Page, width: number, props: Omit<Parameters<typeof mount<"LogFixture">>[2], "texts" | "brand" | "screen"> & { kind?: "ack" | "update" } = {}) {
  await page.setViewportSize({ width, height: 800 });
  const { kind, ...rest } = props;
  await mount(page, "LogFixture", { texts: REAL_TEXTS, brand, screen: logScreen(PLANS, NOW, { kind: kind ?? "ack" }), ...rest });
  await fitToPage(page, width);
}

for (const width of [390, 1280]) {
  test(`Log a disruption at ${width}px`, async ({ page }) => {
    await openLog(page, width);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Log a disruption");
    await expectBaseline(page, `log-${width}.png`);
  });

  test(`the acknowledgement composer, a draft with its text message preview, at ${width}px`, async ({ page }) => {
    await openComposer(page, width, { screen: screenOf("ack", stateOf(), { saved: true }) });
    await expect(page.getByTestId("composer-text")).toHaveValue(ACK_TEXT);
    await expect(page.getByTestId("audience-sentence")).toHaveText("Residents of 4 Milepost Pl (floors 3, 4, 5) and 85-95 Thorncliffe Park Dr (all floors).");
    await expectBaseline(page, `composer-ack-draft-${width}.png`);
  });

  test(`the alert composer, a draft, at ${width}px`, async ({ page }) => {
    await openComposer(page, width, { screen: screenOf("alert", stateOf({ kind: "update", types: ["power", "elevator"] })) });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Write an alert");
    await expectBaseline(page, `composer-alert-draft-${width}.png`);
  });

  test(`a submitted entry with languages that fell back and a possible duplicate, at ${width}px`, async ({ page }) => {
    const state = stateOf({
      entry: { status: "pending_approval", version: 2, contentHash: "d".repeat(64), submittedAt: NOW, possibleDuplicateOf: OTHER },
      translations: SOME_FELL_BACK,
      attempt: { state: "committed", resultVersion: 2, finishedAt: NOW },
    });
    await openComposer(page, width, { screen: screenOf("ack", state, { preview: false }) });
    await expect(page.getByTestId("fallback-summary")).toContainText("2 of 15 languages could not be translated");
    await expect(page.getByTestId("duplicate-note")).toBeVisible();
    await expectBaseline(page, `composer-submitted-fallback-${width}.png`);
  });
}

test("a submit that is running, with the languages settled so far, at 390px", async ({ page }) => {
  const state = stateOf({ attempt: { state: "running", progress: { ur: "fallback_en", ps: "translated", tl: "translated", zh: "translated", fr: "translated" } } });
  await openComposer(page, 390, { screen: screenOf("ack", state) });
  await expect(page.getByTestId("progress-summary")).toHaveText("5 of 15 languages done");
  await expect(page.getByTestId("submit-button")).toBeDisabled();
  await expect(page.getByTestId("save-draft")).toBeDisabled();
  await expectBaseline(page, "composer-running-390.png");
});

test("a submitted entry with every language translated, at 390px", async ({ page }) => {
  const state = stateOf({ entry: { status: "pending_approval", version: 1, contentHash: "d".repeat(64), submittedAt: NOW }, translations: ALL_TRANSLATED, attempt: { state: "committed", resultVersion: 1, finishedAt: NOW } });
  await openComposer(page, 390, { screen: screenOf("ack", state, { preview: false }) });
  await expect(page.getByTestId("all-translated")).toBeVisible();
  await expect(page.getByTestId("retry-translation")).toHaveCount(0);
  await expectBaseline(page, "composer-submitted-translated-390.png");
});

test("a draft after a failed attempt, a refused save and the clock-change question, at 390px", async ({ page }) => {
  const failed = stateOf({ attempt: { state: "failed", outcome: "ROUTES_UNAVAILABLE", finishedAt: NOW } });
  await openComposer(page, 390, { screen: screenOf("ack", failed) });
  await expect(page.locator("p.hub-error")).toContainText("The translation settings could not be read");
  await expectBaseline(page, "composer-failed-390.png");

  await openComposer(page, 390, { screen: screenOf("ack", stateOf()), initial: { save: { status: "refused", message: "The text is too long: at most 600 characters." } } });
  await expect(page.locator("p.hub-error")).toHaveText("The text is too long: at most 600 characters.");
  await expectBaseline(page, "composer-refused-390.png");

  await openComposer(page, 390, {
    screen: screenOf("ack", stateOf()),
    initial: { save: { status: "ask", question: "1:30 a.m. happens twice on Sunday, November 1, because the clocks go back. Do you mean before or after the clock change?", before: "Before the clock change (1:30 a.m. EDT)", after: "After the clock change (1:30 a.m. EST)" } },
  });
  await expect(page.getByTestId("fold-question")).toBeVisible();
  await expectBaseline(page, "composer-clock-change-390.png");
});

test("Log a disruption after a refusal and with the clock-change question, at 390px", async ({ page }) => {
  await openLog(page, 390, { initialState: { status: "refused", message: "Choose at least one type." } });
  await expect(page.locator("p.hub-error")).toHaveText("Choose at least one type.");
  await expectBaseline(page, "log-refused-390.png");

  await openLog(page, 390, {
    initialState: { status: "ask", question: "1:30 a.m. happens twice on Sunday, November 1, because the clocks go back. Do you mean before or after the clock change?", before: "Before the clock change (1:30 a.m. EDT)", after: "After the clock change (1:30 a.m. EST)" },
  });
  await expect(page.getByRole("group", { name: "Before or after the clock change" })).toBeVisible();
  await expectBaseline(page, "log-clock-change-390.png");
});

test("an entry that can no longer be changed here, at 390px", async ({ page }) => {
  const state = stateOf({ entry: { status: "approved", version: 1, contentHash: "d".repeat(64) }, translations: ALL_TRANSLATED });
  await openComposer(page, 390, { screen: screenOf("ack", state, { preview: false }) });
  await expect(page.getByTestId("locked-note")).toContainText("approved and is published");
  await expect(page.locator(".layout-screen__actions")).toHaveCount(0);
  await expectBaseline(page, "composer-locked-390.png");
});

test("fits the phone without scrolling sideways in every state", async ({ page }) => {
  const states: Array<[ComposerMode, EntryState, boolean]> = [
    ["ack", stateOf(), true],
    ["alert", stateOf({ kind: "update", types: ["power", "heat"] }), true],
    ["ack", stateOf({ attempt: { state: "running", progress: { fr: "translated" } } }), true],
    ["ack", stateOf({ entry: { status: "pending_approval", version: 2, contentHash: "d".repeat(64) }, translations: SOME_FELL_BACK }), false],
  ];
  for (const [mode, state, preview] of states) {
    await openComposer(page, 390, { screen: screenOf(mode, state, { preview }) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${mode} ${state.entry.status}`).toBe(true);
  }
});
