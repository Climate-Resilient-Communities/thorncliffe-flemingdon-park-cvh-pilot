import { expect, test, type Page } from "@playwright/test";
import type { DirectoryReleaseView } from "../../src/app/staff/directory/DirectoryRelease";
import type { PublishState } from "../../src/app/staff/directory/publishRelease";
import { directoryReleaseView } from "../../src/app/staff/directory/view";
import { staleLines } from "../../src/app/staff/directory/words";
import { englishText } from "../../src/i18n/text";
import type { ReleaseSummary } from "../../src/modules/directory";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mountHydrated } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S02.05: the Directory release screen in the Hub shell, in en as an Admin sees it: the current release with what it
// held back, none yet, the button's done message and its "Publish failed". The real DirectoryRelease renders with the
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
  counts: { providers: 91, categories: 8, languages: 16, files: 16, translations: 1180, fallbacks: 262, stale: 2 },
  report: {
    stale: [
      { subject: "M014", text: "services", lang: "ur" },
      { subject: "M014", text: "emergency_role", lang: "ur" },
    ],
    unavailable: [],
  },
  ...change,
});
const day = (date: Date) => date.toISOString().slice(0, 10);
const PROVIDERS = { published: 91, total: 99 };

const viewWithRelease = () => directoryReleaseView(release(), release(), PROVIDERS, day);
const viewWithNone = () => directoryReleaseView(null, null, { published: 0, total: 99 }, day);
const viewAfterFailure = () => directoryReleaseView(release(), release({ number: 5, status: "failed", isCurrent: false, failure: "storage_unavailable", attempts: 3 }), PROVIDERS, day);

const doneAnswer = (): PublishState => ({
  status: "done",
  message: englishText("staff.directory.done", { number: 5, providers: 91, languages: 16 }),
  notes: [englishText("staff.directory.fallbacks", { count: 260 })],
  stale: {
    heading: englishText("staff.directory.staleHeading", { count: 2 }),
    items: staleLines(release().report),
  },
});
const failedAnswer = (): PublishState => ({
  status: "refused",
  message: `${englishText("staff.directory.failed", { reason: englishText("staff.directory.reasons.storageUnavailable") })}. ${englishText("staff.directory.previousStays")}`,
  problems: null,
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
    await expect(page.getByTestId("release-stale").getByRole("listitem")).toHaveText(["M014, services, ur", "M014, emergency_role, ur"]);
    await expect(page.getByTestId("release-last-failed")).toHaveCount(0);
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

  test(`directory release done message at ${width}px: the status region fills with the stale list, no alert`, async ({ page }) => {
    await open(page, width, viewWithRelease(), doneAnswer());
    await button(page).click();

    await expect(page.getByTestId("publish-message")).toHaveText("Release 5 is now current. Providers: 91. Languages: 16.");
    await expect(page.getByTestId("publish-stale").getByRole("listitem")).toHaveText(["M014, services, ur", "M014, emergency_role, ur"]);
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
}
