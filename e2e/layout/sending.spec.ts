import { expect, test, type Page } from "@playwright/test";
import { approvalScreen, type ApprovalScreen } from "../../src/app/staff/alerts/approval/view";
import type { ProblemListScreen, SendingScreen } from "../../src/app/staff/alerts/sending/load";
import { problemListView, sendingProgressView, type Text } from "../../src/app/staff/alerts/sending/view";
import { progressOf, type ProblemText } from "../../src/modules/messaging";
import { APPROVER, PLANS, reviewOf } from "../../test/helpers/approvalReview";
import { checkHubShellBoundaries, checkHubTwoColumnBoundaries, expectNoHorizontalOverflow, hubPage, type HubLanguage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { longestLabels } from "../helpers/strings";

// S06.09: the sending progress, at content widths of 799 and 800 px (viewports of 1087 and 1088 px with the side navigation) and at viewports of 699 and 700 px, in `en` and `ur`
// with the longest translated labels of the language in every place the screens show text: the alert's staff view (one column, with every state that can be on it: counts per
// language and in all, skipped texts, the sentence about texts already handed to the provider, the links to the lists, a practice alert, a note that it could not be read), the list of
// the texts that did not arrive, and the published confirmation (O-06) with the progress in its main column. Nothing overflows horizontally and every link is a 44 px target. The checks
// are the shared boundary helpers of S01.16 (e2e/helpers/hub-layout-boundaries.ts), run on the app's own bodies inside the real Hub shell.
const brand = hubBrand();
const REF = { alertId: "01900000-0000-7000-8000-00000000a1e7", entryId: "01900000-0000-7000-8000-00000000e177" };

type Row = Parameters<typeof progressOf>[0][number];
const rows = (lang: string, state: Row["state"], n: number, handedOff = false): Row[] => Array.from({ length: n }, () => ({ lang, state, handedOff }));
const PROGRESS = progressOf([
  ...rows("en", "delivered", 4120, true),
  ...rows("en", "queued", 1200),
  ...rows("ur", "claimed", 4, true),
  ...rows("ur", "failed", 12),
  ...rows("zh-Hant", "undelivered", 2, true),
  ...rows("prs", "unknown", 1, true),
  ...rows("hi", "cancelled", 30),
  ...rows("hi", "skipped", 3),
]);

/** Every text of the screens replaced by one of the language's longest labels (its longest sentences, words and one unbreakable token). */
function longestText(lang: string): Text {
  const { sentences, words, unbreakable } = longestLabels(lang);
  const pool = [...sentences, ...words, unbreakable, ...sentences.map((sentence) => `${sentence} ${sentence}`)];
  return (key) => pool[[...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7) % pool.length];
}

const BACK = { href: "/staff/alerts/approve?alert=a&entry=e", label: "Back to the alert" };
const at = new Date("2026-10-05T18:15:00Z");
const problem = (n: number, over: Partial<ProblemText>): ProblemText => ({ id: `01900000-0000-7000-8000-0000000abc${String(n).padStart(2, "0")}`, reference: `0abc${String(n).padStart(2, "0")}`, lang: "ur", state: "failed", meaning: "not_in_service", code: null, at, resendN: null, resends: 0, resent: false, ...over });

function screens(lang: string, text?: Text): Record<string, SendingScreen> {
  const heading = text ? `${longestLabels(lang).sentences[0]}` : "Elevator, Power · Acknowledgement";
  const base = { kind: "screen" as const, ref: REF, heading, notice: null, back: text ? { ...BACK, label: text("back") } : BACK };
  const block = (paused: boolean, progress = PROGRESS) => ({ kind: "progress" as const, view: sendingProgressView({ ref: REF, progress, paused, ...(text ? { text, compose: text } : {}) }) });
  return {
    "the alert's staff view going out": { ...base, block: block(false) },
    "the alert's staff view while texts are paused": { ...base, block: block(true) },
    "the alert's staff view with no text": { ...base, block: block(false, progressOf([])) },
    "the alert's staff view of a practice alert": { ...base, block: null, notice: { message: text ? text("drill") : "This is a practice alert.", link: { href: "/staff/drills", label: text ? text("drillLink") : "Open the Drills page" } } },
    "the alert's staff view that could not be read": { ...base, block: { kind: "unavailable", note: text ? text("unavailable") : "The sending progress could not be read just now." } },
  };
}

function lists(lang: string, text?: Text): Record<string, ProblemListScreen> {
  const heading = text ? longestLabels(lang).sentences[0] : "Elevator, Power · Acknowledgement";
  const texts = [
    problem(1, { meaning: "not_in_service" }),
    problem(2, { lang: "zh-Hant", meaning: "sender_not_ready" }),
    problem(3, { lang: "prs", meaning: "other_code", code: 31999 }),
    problem(4, { lang: "hi", meaning: "retries_exhausted", state: "failed" }),
  ];
  // The Admin's lists (S09.02): a Resend on each text that can be resent, a note on the ones that cannot, the warning and box of an unknown text, and a button for each language.
  const admin = { canResend: true, resendLanguages: ["en", "ur", "zh-Hant", "prs"] };
  const adminTexts = [problem(5, { meaning: "no_reason" }), problem(6, { lang: "zh-Hant", meaning: "retries_exhausted", resendN: 1, resends: 1 }), problem(7, { lang: "prs", meaning: "no_reason", resent: true, resends: 1 }), problem(8, { lang: "hi", meaning: "invalid_number" })];
  return {
    "the Admin's list of failed texts": { kind: "list", ref: REF, heading, list: problemListView({ ref: REF, state: "failed", texts: adminTexts, more: false, limit: 200, ...admin, ...(text ? { text, compose: text } : {}) }) },
    "the Admin's list of texts with an unknown outcome": {
      kind: "list",
      ref: REF,
      heading,
      list: problemListView({ ref: REF, state: "unknown", texts: adminTexts.map((item) => ({ ...item, state: "unknown", meaning: "unclear", code: null })), more: false, limit: 200, ...admin, ...(text ? { text, compose: text } : {}) }),
    },
    "the list of failed texts": { kind: "list", ref: REF, heading, list: problemListView({ ref: REF, state: "failed", texts, more: true, limit: 200, ...(text ? { text, compose: text } : {}) }) },
    "the list of texts with an unknown outcome": { kind: "list", ref: REF, heading, list: problemListView({ ref: REF, state: "unknown", texts: texts.map((item) => ({ ...item, state: "unknown", meaning: "unclear", code: null })), more: false, limit: 200, ...(text ? { text, compose: text } : {}) }) },
    "the empty list": { kind: "list", ref: REF, heading, list: problemListView({ ref: REF, state: "undelivered", texts: [], more: false, limit: 200, ...(text ? { text, compose: text } : {}) }) },
  };
}

type Words = "longest" | "real";
const textsFor = (lang: HubLanguage, words: Words) => (words === "longest" ? longestTexts(lang) : REAL_TEXTS);
const textOf = (lang: HubLanguage, words: Words) => (words === "longest" ? longestText(lang) : undefined);

const openScreen = (page: Page, name: string, lang: HubLanguage, words: Words = "longest") =>
  mount(page, "SendingFixture", { texts: textsFor(lang, words), brand, screen: screens(lang, textOf(lang, words))[name] }, { lang });
const openList = (page: Page, name: string, lang: HubLanguage, words: Words = "longest") =>
  mount(page, "SendingFixture", { texts: textsFor(lang, words), brand, list: lists(lang, textOf(lang, words))[name], ...(name.startsWith("the Admin's") ? { resend: {} } : {}) }, { lang });

const NAMES = Object.keys(screens("en"));
const LIST_NAMES = Object.keys(lists("en"));

async function expectTargets(page: Page) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main a[href], main summary, main button")]
      .filter((element) => element.getBoundingClientRect().height > 0)
      .map((element) => ({ text: element.textContent?.trim().slice(0, 40), height: Math.round(element.getBoundingClientRect().height) }))
      .filter((target) => target.height < 44),
  );
  expect(small).toEqual([]);
}

for (const name of NAMES) {
  test.describe(name, () => {
    test("keeps the shell's breakpoint at viewports of 699 and 700 px, in en and ur with the longest labels, with no horizontal overflow", async ({ page }) => {
      await checkHubShellBoundaries(page, { open: (lang) => openScreen(page, name, lang) });
    });

    test("has no horizontal overflow at content widths of 799 and 800 px (viewports of 1087 and 1088 px), and its links and summaries are 44 px targets", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        for (const width of [1087, 1088]) {
          await page.setViewportSize({ width, height: 900 });
          await openScreen(page, name, lang);
          await expectNoHorizontalOverflow(page, hubPage(page));
          await expectTargets(page);
        }
      }
    });
  });
}

for (const name of LIST_NAMES) {
  test.describe(name, () => {
    test("keeps the shell's breakpoint at viewports of 699 and 700 px, in en and ur with the longest labels, with no horizontal overflow", async ({ page }) => {
      await checkHubShellBoundaries(page, { open: (lang) => openList(page, name, lang) });
    });

    test("has no horizontal overflow at viewports of 1087 and 1088 px, and its links are 44 px targets", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        for (const width of [1087, 1088]) {
          await page.setViewportSize({ width, height: 900 });
          await openList(page, name, lang);
          await expectNoHorizontalOverflow(page, hubPage(page));
          await expectTargets(page);
        }
      }
    });
  });
}

// The published confirmation (O-06) with the progress in its main column.
function published(lang: string, text?: Text): ApprovalScreen {
  const { sentences, unbreakable } = longestLabels(lang);
  const sending = { kind: "progress" as const, view: sendingProgressView({ ref: REF, progress: PROGRESS, paused: true, ...(text ? { text, compose: text } : {}) }) };
  return approvalScreen({
    review: reviewOf({ entry: { status: "approved" } as never, words: text ? { web: `${sentences[0]} ${unbreakable}`, sms: `${sentences[1] ?? sentences[0]}\n${unbreakable}` } : undefined }),
    plans: PLANS,
    pricePerSegmentCents: 1.5,
    viewerId: APPROVER,
    sending,
    ...(text ? { text } : {}),
  });
}

test.describe("O-06 with the sending progress", () => {
  const open = (page: Page, lang: HubLanguage) => mount(page, "ApprovalFixture", { texts: longestTexts(lang), brand, screen: published(lang, longestText(lang)) }, { lang });

  test("is one column below 800 px of content width and two from 800 px, in en and ur with the longest labels, with no horizontal overflow", async ({ page }) => {
    await checkHubTwoColumnBoundaries(page, { open: (lang) => open(page, lang) });
  });

  test("keeps the shell's breakpoint at viewports of 699 and 700 px, in en and ur, with no horizontal overflow", async ({ page }) => {
    await checkHubShellBoundaries(page, { open: (lang) => open(page, lang) });
  });
});
