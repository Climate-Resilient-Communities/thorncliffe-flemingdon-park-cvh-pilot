import { expect, test, type Page } from "@playwright/test";
import type { DirectoryReleaseView } from "../../src/app/staff/directory/DirectoryRelease";
import type { PublishState } from "../../src/app/staff/directory/publishRelease";
import { directoryReleaseView } from "../../src/app/staff/directory/view";
import { catalogueMismatchText } from "../../src/app/staff/directory/words";
import { englishText } from "../../src/i18n/text";
import type { ReleaseSummary } from "../../src/modules/directory";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mountHydrated } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S02.05: the Directory release screen in the Hub shell, in en as an Admin sees it: the current release with what it
// held back, none yet, a publish in progress or stalled, the button's done message, its "Publish failed" and the
// "database holds another catalogue" refusal. The real DirectoryRelease renders with the
// button and error styles of hub-forms.css; its action is the harness's stand-in (e2e/helpers/directory-actions-stub.ts).
// The behaviour against a real server and database is e2e/staff/directory.spec.ts.
const brand = hubBrand();
const HEIGHT = 844;

const texts = { ...REAL_TEXTS, heading: englishText("staff.directory.title"), paragraphs: [englishText("staff.directory.lead")] };

const release = (change: Partial<ReleaseSummary> = {}): ReleaseSummary => ({
  number: 4,
  status: "complete",
  isCurrent: true,
  startedAt: new Date("2026-10-02T14:59:00Z"),
  publishedAt: new Date("2026-10-02T15:00:00Z"),
  failure: null,
  attempts: 1,
  leaseUntil: null,
  counts: { providers: 91, categories: 8, languages: 16, files: 16, translations: 1180, fallbacks: 262, stale: 2 },
  report: {
    stale: [
      { subject: "M014", name: "Legal Aid Ontario", text: "services", lang: "ur" },
      { subject: "M014", name: "Legal Aid Ontario", text: "emergency_role", lang: "ur" },
    ],
    unavailable: [],
  },
  ...change,
});
const day = (date: Date) => date.toISOString().slice(0, 10);
const NOW = new Date("2026-10-02T15:05:00Z");
const PROVIDERS = { published: 91, total: 99 };

const viewWithRelease = () => directoryReleaseView(release(), release(), PROVIDERS, day, NOW);
const viewWithNone = () => directoryReleaseView(null, null, { published: 0, total: 99 }, day, NOW);
const viewAfterFailure = () => directoryReleaseView(release(), release({ number: 5, status: "failed", isCurrent: false, failure: "storage_unavailable", attempts: 3 }), PROVIDERS, day, NOW);
const building = (leaseUntil: Date | null) => release({ number: 5, status: "building", isCurrent: false, publishedAt: null, attempts: 2, leaseUntil });
const viewInProgress = () => directoryReleaseView(release(), building(new Date("2026-10-02T15:06:30Z")), PROVIDERS, day, NOW);
const viewStalled = () => directoryReleaseView(release(), building(null), PROVIDERS, day, NOW);

const doneAnswer = (): PublishState => ({
  status: "done",
  message: englishText("staff.directory.done", { number: 5, providers: 91, languages: 16 }),
  notes: [englishText("staff.directory.fallbacks", { count: 260 })],
});
const failedAnswer = (): PublishState => ({
  status: "refused",
  message: `${englishText("staff.directory.failed", { reason: englishText("staff.directory.reasons.storageUnavailable") })}. ${englishText("staff.directory.previousStays")}`,
  problems: null,
});
const catalogueMismatchAnswer = (): PublishState => ({
  status: "refused",
  message: `${englishText("staff.directory.failed", { reason: englishText("staff.directory.reasons.catalogueNotLoaded") })}. ${englishText("staff.directory.previousStays")}`,
  problems: catalogueMismatchText({ loaded: "a1b2c3d4e5f6".padEnd(64, "0"), deployed: "f6e5d4c3b2a1".padEnd(64, "0"), commit: "3ac94e1d2c4b5a69788796a5b4c3d2e1f0a9b8c7" }),
});

async function open(page: Page, width: number, view: DirectoryReleaseView, answer?: PublishState) {
  await page.setViewportSize({ width, height: HEIGHT });
  await mountHydrated(page, "DirectoryFixture", { texts, brand, view }, { lang: "en" });
  // What the harness's stand-in for the action answers (e2e/helpers/directory-actions-stub.ts).
  await page.evaluate((value) => void ((globalThis as unknown as { __directoryAnswer?: unknown }).__directoryAnswer = value), answer);
}

const button = (page: Page) => page.getByRole("button", { name: "Publish directory" });

for (const width of [1280, 390]) {
  test(`directory release with a current release at ${width}px`, async ({ page }) => {
    await open(page, width, viewWithRelease());

    await expect(page.getByTestId("release-current")).toHaveText("Current release: 4, published 2026-10-02.");
    await expect(page.getByTestId("release-counts")).toHaveText("Providers: 91. Categories: 8. Languages: 16.");
    await expect(page.getByTestId("release-published-now")).toHaveText("Providers published now: 91 of 99.");
    await expect(page.getByTestId("release-stale").getByRole("listitem")).toHaveText(["Legal Aid Ontario: Services, Urdu", "Legal Aid Ontario: Emergency role, Urdu"]);
    await expect(page.getByTestId("release-last-failed")).toHaveCount(0);
    await expect(page.getByTestId("release-building")).toHaveCount(0);
    await expect(button(page)).toBeEnabled();
    await expect(page.getByTestId("publish-message")).toHaveText("");
    await expectBaseline(page, `directory-en-current-${width}.png`, { fullPage: true });
  });

  test(`directory release before the first publish at ${width}px`, async ({ page }) => {
    await open(page, width, viewWithNone());

    await expect(page.getByTestId("release-none")).toHaveText("No release has been published yet. Residents see no directory until one is.");
    await expect(page.getByTestId("release-current")).toHaveCount(0);
    await expect(button(page)).toBeEnabled();
    await expectBaseline(page, `directory-en-none-${width}.png`, { fullPage: true });
  });

  test(`directory release after a failed publish at ${width}px: the last failure, and the previous release still current`, async ({ page }) => {
    await open(page, width, viewAfterFailure());

    await expect(page.getByTestId("release-last-failed")).toHaveText("The last publish failed: the files could not be stored. The previous release is still current.");
    await expect(page.getByTestId("release-last-failed")).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("release-current")).toHaveText("Current release: 4, published 2026-10-02.");
    await expectBaseline(page, `directory-en-last-failed-${width}.png`, { fullPage: true });
  });

  test(`directory release with a publish in progress at ${width}px: told as in progress, not as a failure`, async ({ page }) => {
    await open(page, width, viewInProgress());

    await expect(page.getByTestId("release-building")).toHaveText("A publish is in progress: release 5. Reload this page in a minute to see whether it finished.");
    await expect(page.getByTestId("release-building")).toHaveAttribute("data-state", "in-progress");
    await expect(page.getByTestId("release-last-failed")).toHaveCount(0);
    await expect(page.getByTestId("release-current")).toHaveText("Current release: 4, published 2026-10-02.");
    await expectBaseline(page, `directory-en-in-progress-${width}.png`, { fullPage: true });
  });

  test(`directory release with a stalled publish at ${width}px: told it stopped, and that Publish continues it`, async ({ page }) => {
    await open(page, width, viewStalled());

    await expect(page.getByTestId("release-building")).toHaveText("A publish stopped before it finished: release 5. Press Publish directory to continue it; the files already stored are kept.");
    await expect(page.getByTestId("release-building")).toHaveAttribute("data-state", "stalled");
    await expect(button(page)).toBeEnabled();
    await expectBaseline(page, `directory-en-stalled-${width}.png`, { fullPage: true });
  });

  test(`directory release done message at ${width}px: the status region says so and the stale list is on the page once, no alert`, async ({ page }) => {
    await open(page, width, viewWithRelease(), doneAnswer());
    await button(page).click();

    await expect(page.getByTestId("publish-message")).toHaveText("Release 5 is now current. Providers: 91. Languages: 16.");
    // The page lists what the release held back; the answer does not list it a second time.
    await expect(page.getByTestId("publish-stale")).toHaveCount(0);
    await expect(page.getByText("Legal Aid Ontario: Services, Urdu")).toHaveCount(1);
    await expect(page.getByTestId("publish-error")).toHaveCount(0);
    await expectBaseline(page, `directory-en-done-${width}.png`, { fullPage: true });
  });

  test(`directory release "Publish failed" at ${width}px: a separate bold alert, with the status region still empty`, async ({ page }) => {
    await open(page, width, viewWithRelease(), failedAnswer());
    await button(page).click();

    await expect(page.getByTestId("publish-error")).toContainText("Publish failed: the files could not be stored. The previous release is still current.");
    await expect(page.getByTestId("publish-error")).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("publish-message")).toHaveText("");
    await expectBaseline(page, `directory-en-failed-${width}.png`, { fullPage: true });
  });

  test(`directory release when the database holds another catalogue at ${width}px: which one, which this deployment has, and what to run`, async ({ page }) => {
    await open(page, width, viewWithRelease(), catalogueMismatchAnswer());
    await button(page).click();

    const error = page.getByTestId("publish-error");
    await expect(error).toContainText("Publish failed: the database holds a different catalogue than this deployment. The previous release is still current.");
    await expect(error).toContainText("The database holds catalogue a1b2c3d4e5f6, this deployment has f6e5d4c3b2a1: run `npm run seed:providers` from commit 3ac94e1, then publish.");
    await expect(error).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("publish-message")).toHaveText("");
    await expectBaseline(page, `directory-en-catalogue-mismatch-${width}.png`, { fullPage: true });
  });
}
