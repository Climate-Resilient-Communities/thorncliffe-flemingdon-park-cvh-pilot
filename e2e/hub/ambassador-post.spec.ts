import { test, type Page } from "@playwright/test";
import type { PostInitial } from "../../src/app/staff/ambassador/post/PostForm";
import { postScreen, type PostData } from "../../src/app/staff/ambassador/post/view";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S08.02: an ambassador's post (A-02) inside the Hub shell at 390 px, the width it is made for, and at 1280 px: a new post before anything is chosen; Other
// chosen with the 911 block first and its line missing; a post held in the page because there is no signal; a practice post in a drill; and the post sent. The
// view is the app's own (src/app/staff/ambassador/post/view.ts) and the form its own PostForm. The behaviour is asserted in postSender.test.ts, postScreen.test.tsx,
// test/db/ambassadorPost.db.test.ts and e2e/staff/ambassador-post.spec.ts; these pictures show what it looks like. The staff screens are English in the pilot.
const brand = hubBrand();
const FLOORS = ["G", ...Array.from({ length: 17 }, (_, index) => String(index + 1))].map((label, index) => ({ id: `01900000-0000-7000-8000-0000000f${String(index + 1).padStart(4, "0")}`, label }));
const DATA: PostData = {
  buildings: [{ rsn: "4154146", address: "4 Milepost Pl", floors: FLOORS }],
  thread: null,
  ids: { alertId: "01900000-0000-7000-8000-00000000a1e7", entryId: "01900000-0000-7000-8000-00000000e17a" },
};
const DRILL: PostData = { ...DATA, thread: { id: "01900000-0000-7000-8000-00000000d111", isDrill: true, headline: "Drill: the elevators are out of service in 4 Milepost Pl.", types: ["elevator"] } };

const open = (page: Page, data: PostData, width: number, initial?: PostInitial) =>
  page.setViewportSize({ width, height: 844 }).then(() => mount(page, "AmbassadorPostFixture", { texts: REAL_TEXTS, brand, screen: postScreen(data), initial }));

for (const width of [390, 1280]) {
  test(`A-02 a new post at ${width}px`, async ({ page }) => {
    await open(page, DATA, width);
    await expectBaseline(page, `ambassador-post-${width}.png`, { fullPage: true });
  });
}

test("A-02 Other chosen, the 911 block first and the line missing, at 390px", async ({ page }) => {
  await open(page, DATA, 390, { types: ["other"], floorsMode: "range", phase: "problem", problems: ["line"] });
  await expectBaseline(page, "ambassador-post-other-390.png", { fullPage: true });
});

test("A-02 a post held in the page without signal at 390px", async ({ page }) => {
  await open(page, DATA, 390, { types: ["elevator", "water"], phase: "problem", text: "The elevator is out and there is no water on floors 10 to 17.", state: { kind: "unsent" } });
  await expectBaseline(page, "ambassador-post-unsent-390.png", { fullPage: true });
});

test("A-02 a practice post in a drill at 390px", async ({ page }) => {
  await open(page, DRILL, 390);
  await expectBaseline(page, "ambassador-post-drill-390.png", { fullPage: true });
});

test("A-02 the post sent, waiting for the Hub, at 390px", async ({ page }) => {
  await open(page, DATA, 390, { state: { kind: "done" } });
  await expectBaseline(page, "ambassador-post-done-390.png", { fullPage: true });
});

test("A-02 the post sent and already live, not yet verified, at 390px (S08.04)", async ({ page }) => {
  await open(page, DATA, 390, { state: { kind: "done", live: true } });
  await expectBaseline(page, "ambassador-post-live-390.png", { fullPage: true });
});
