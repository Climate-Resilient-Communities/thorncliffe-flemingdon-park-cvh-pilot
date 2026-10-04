// Drills in a browser (S06.05), against the production build with a real database, the identity fake and SMS_MODE=log (playwright.staff.config.ts): an Admin at
// aal2 adds, changes and removes drill roster phones (the list shows only the last four digits, the change is audited without the number, the name or the language);
// starts a drill, which is a thread whose is_drill is true with the exercise marker on its screens; a second Admin approves it, which writes one text per roster phone
// in the entry's frozen body for the phone's language with the exercise marker first, and to nobody else; the Drills page shows what became of the texts per member
// and language; the drill's share link is a 404; and the roles that cannot run drills are told so and have no menu item. Every number is fictional (555). Nothing
// here sends a text: the server runs with SMS_MODE=log.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { approve, newBuilding, newCoordinator, personOnAPhone, signIn, type Person } from "./alert-flow";
import { openDatabase } from "./helpers";

let sql: postgres.Sql;
let auditMark = 0;

async function clearState() {
  await sql`delete from drill_roster`;
}

test.beforeAll(async () => {
  sql = openDatabase();
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
});

test.afterAll(async () => {
  await clearState();
  await sql?.end({ timeout: 5 });
});

test.beforeEach(async () => {
  await clearState();
  [{ max: auditMark }] = await sql`select coalesce(max(id), 0)::int as max from audit_event`;
});

async function expectNoHorizontalScroll(page: Page) {
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth, "document scrollWidth <= clientWidth").toBeLessThanOrEqual(root.clientWidth);
}

const audits = (like = "drill_roster.%") => sql`select action, actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditMark} and action like ${like} order by id`;
const roster = () => sql`select label, phone, lang, added_by from drill_roster order by created_at, id`;

async function addPhone(page: Page, label: string, number: string, language: string) {
  await page.getByLabel("Name or role").first().fill(label);
  await page.getByLabel("Mobile number").first().fill(number);
  await page.getByLabel("Language of the drill text").first().selectOption({ label: language });
  await page.getByRole("button", { name: "Add phone" }).click();
}

test("an Admin adds, changes and removes drill roster phones, sees only their last four digits, and each change is audited without the number, the name or the language", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const admin = await newCoordinator(sql, "admin");
  await signIn(page, admin);

  const side = page.getByTestId("hub-side");
  await side.getByRole("link", { name: "Drills" }).click();
  await expect(page).toHaveURL(/\/staff\/drills$/);
  await expect(page.getByRole("heading", { level: 1, name: "Drills" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(side.getByRole("link", { name: "Drills" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("drills-roster-summary")).toHaveText("The drill roster is empty, so a drill reaches no one yet.");
  await page.getByTestId("drills-roster-link").click();
  await expect(page).toHaveURL(/\/staff\/drills\/roster$/);
  await expect(page.getByRole("heading", { level: 1, name: "Drill roster" })).toBeVisible();
  await expect(page.getByTestId("drill-roster-empty")).toContainText("The drill roster is empty.");

  // A number that is not Canadian is refused by the server, and nothing changes.
  await addPhone(page, "Hub phone", "020 7946 0958", "English");
  await expect(page.getByTestId("drill-roster-error")).toHaveText("That is not a Canadian mobile number. Use ten digits, for example 416-555-0123.");
  expect(await roster()).toEqual([]);

  await addPhone(page, "Hub phone", "(416) 555-0123", "English");
  await expect(page.getByTestId("drill-roster-answer")).toContainText("Hub phone was added. The roster now has 1 phone.");
  await expect(page.getByTestId("drill-roster-count")).toHaveText("1 phone on the roster");
  await expect(page.getByTestId("drill-roster-list")).toContainText("+1 ••• ••• 0123");
  await expect(page.getByTestId("drill-roster-list")).toContainText("Drill text in English");
  // The same number again, written another way, is refused.
  await addPhone(page, "Again", "1-416-555-0123", "English");
  await expect(page.getByTestId("drill-roster-error")).toHaveText("That number is already on the roster.");

  await addPhone(page, "Priya", "647 555 0199", "Urdu");
  await expect(page.getByTestId("drill-roster-answer")).toContainText("Priya was added. The roster now has 2 phones.");
  await expect(page.getByTestId("drill-roster-row")).toHaveCount(2);
  await expect(page.getByTestId("drill-roster-list")).toContainText("Drill text in Urdu");

  // Nothing on the page, in any form, holds a whole number.
  const html = await page.content();
  for (const number of ["4165550123", "6475550199", "416-555-0123", "416 555 0123"]) expect(html).not.toContain(number);
  expect(await roster()).toEqual([
    { label: "Hub phone", phone: "+14165550123", lang: "en", added_by: admin.id },
    { label: "Priya", phone: "+16475550199", lang: "ur", added_by: admin.id },
  ]);

  // Change Priya's name and language, leaving her number as it is.
  const priya = page.getByTestId("drill-roster-row").filter({ hasText: "Priya" });
  await priya.locator("summary").click();
  await priya.getByLabel("Name or role").fill("Priya S.");
  await priya.getByLabel("Language of the drill text").selectOption({ label: "Hindi" });
  await priya.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("drill-roster-answer")).toContainText("Priya S. was changed.");
  expect(await roster()).toEqual([
    { label: "Hub phone", phone: "+14165550123", lang: "en", added_by: admin.id },
    { label: "Priya S.", phone: "+16475550199", lang: "hi", added_by: admin.id },
  ]);

  await page.getByRole("button", { name: "Remove Hub phone" }).click();
  await expect(page.getByTestId("drill-roster-answer")).toContainText("Hub phone was removed. The roster now has 1 phone.");
  await expect(page.getByTestId("drill-roster-row")).toHaveCount(1);
  expect((await roster()).map((row) => row.label)).toEqual(["Priya S."]);

  // In the order they happened. Only the roster's size, or for a refusal its reason, is in any of them.
  expect((await audits()).map((a) => [a.action, a.actor_staff_id, a.subject_type, a.outcome, a.meta])).toEqual([
    ["drill_roster.added", admin.id, "drill_roster", "refused", { reason: "validation" }],
    ["drill_roster.added", admin.id, "drill_roster", "ok", { roster_size: 1 }],
    ["drill_roster.added", admin.id, "drill_roster", "refused", { reason: "duplicate" }],
    ["drill_roster.added", admin.id, "drill_roster", "ok", { roster_size: 2 }],
    ["drill_roster.edited", admin.id, "drill_roster", "ok", { roster_size: 2 }],
    ["drill_roster.removed", admin.id, "drill_roster", "ok", { roster_size: 1 }],
  ]);
  const everything = JSON.stringify(await sql`select * from audit_event where id > ${auditMark}`);
  for (const secret of ["4165550123", "6475550199", "Hub phone", "Priya", '"ur"', '"hi"']) expect(everything).not.toContain(secret);
});

test("a phone shows the Drills page, the roster and the start form without a sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const admin = await newCoordinator(sql, "admin");
  await signIn(page, admin);
  await sql`insert into drill_roster (id, label, phone, lang, added_by) values (${randomUUID()}, 'Priya Sharma, Hub Director weekends', '+16475550199', 'ur', ${admin.id})`;

  await page.goto("/staff/drills");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Drills" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/staff/drills/roster");
  await expect(page.getByTestId("drill-roster-row")).toHaveCount(1);
  await expectNoHorizontalScroll(page);

  await page.goto("/staff/drills/start");
  await expect(page.getByRole("heading", { level: 1, name: "Start a drill" })).toBeVisible();
  await expect(page.getByTestId("exercise-marker")).toContainText("Exercise. This is practice.");
  await expectNoHorizontalScroll(page);
});

test("an Admin starts a drill, a second Admin approves it, only the roster is texted, the Drills page counts the texts, and the share link is a 404", async ({ browser, baseURL }) => {
  const rsn = await newBuilding(sql, "88 Drill Run Dr");
  const author = await newCoordinator(sql, "admin");
  const approver = await newCoordinator(sql, "admin");
  const hub = await sql`insert into drill_roster (id, label, phone, lang, added_by) values (${randomUUID()}, 'Hub phone', '+14165550123', 'en', ${author.id}) returning id`;
  const priya = await sql`insert into drill_roster (id, label, phone, lang, added_by) values (${randomUUID()}, 'Priya', '+16475550199', 'ur', ${author.id}) returning id`;
  const members = [hub[0].id as string, priya[0].id as string];

  const phone = await personOnAPhone(browser, baseURL, author);
  const page = phone.page;
  try {
    await page.goto("/staff/drills");
    await expect(page.getByTestId("drills-none")).toBeVisible();
    await expect(page.getByTestId("drills-roster-summary")).toHaveText("2 people are on the drill roster.");
    await page.getByRole("button", { name: "Start a drill" }).click();
    await expect(page).toHaveURL(/\/staff\/drills\/start$/);
    await expect(page.getByTestId("exercise-marker")).toContainText("Nothing here is sent to residents.");
    await page.getByLabel("Elevator", { exact: true }).check();
    await page.getByRole("radio", { name: /^Buildings/ }).check();
    await page.getByTestId(`building-${rsn}`).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue to the drill acknowledgement" }).click();

    // The thread is a drill, and the acknowledgement composer says so.
    await expect(page).toHaveURL(/\/staff\/alerts\/ack\?alert=[0-9a-f-]+&entry=[0-9a-f-]+$/);
    const url = new URL(page.url());
    const ref = { alertId: url.searchParams.get("alert") as string, entryId: url.searchParams.get("entry") as string };
    await expect(page.getByTestId("exercise-marker")).toContainText("Exercise. This is practice.");
    expect((await sql`select is_drill, slug from alert where id = ${ref.alertId}`)[0]).toMatchObject({ is_drill: true });
    expect((await audits("alert.created")).at(-1)).toMatchObject({ outcome: "ok", actor_staff_id: author.id });
    expect((await sql`select is_drill from audit_event where id > ${auditMark} and action = 'alert.created' order by id desc limit 1`)[0]).toEqual({ is_drill: true });

    // The audience pages of the drill carry the marker too.
    await page.goto(`/staff/alerts/audience?alert=${ref.alertId}&entry=${ref.entryId}&from=ack`);
    await expect(page.getByTestId("exercise-marker")).toBeVisible();
    await page.goto(`/staff/alerts/ack?alert=${ref.alertId}&entry=${ref.entryId}`);

    // The author submits it; a second Admin reviews it, with the marker and the roster's count, and approves it.
    await page.getByTestId("submit-button").click();
    await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("exercise-marker")).toBeVisible();

    const second = await personOnAPhone(browser, baseURL, approver);
    try {
      await second.page.goto(`/staff/alerts/approve?alert=${ref.alertId}&entry=${ref.entryId}`);
      await expect(second.page.getByTestId("exercise-marker")).toContainText("Exercise. This is practice.");
      await expect(second.page.getByTestId("drill-note")).toContainText("This is a drill. It never reaches residents.");
      await expect(second.page.getByTestId("recipient-count")).toHaveText("2");
      await approve(second.page, ref);
      await expect(second.page.getByTestId("exercise-marker")).toBeVisible();
    } finally {
      await second.context.close();
    }

    // The approval wrote one text per roster phone, and to no one else, each in the entry's frozen body for the phone's language with the exercise marker first.
    const entry = (await sql`select sms_bodies from alert_entry where id = ${ref.entryId}`)[0].sms_bodies as Record<string, { body: string }>;
    const texts = await sql`select recipient_kind, recipient_id, lang, body, kind from delivery where entry_id = ${ref.entryId} order by lang`;
    expect(texts.map((text) => [text.kind, text.recipient_kind]).sort()).toEqual([["alert", "roster"], ["alert", "roster"]]);
    expect(texts.map((text) => text.recipient_id).sort()).toEqual([...members].sort());
    expect(texts.map((text) => text.lang).sort()).toEqual(["en", "ur"]);
    for (const text of texts) expect(text.body, text.lang).toBe(entry[text.lang as string].body);
    // The exercise marker is the first line, in the language of the text (English: "Exercise. Practice only.").
    expect(texts.find((text) => text.lang === "en")?.body.startsWith("Exercise. Practice only.")).toBe(true);
    expect((texts.find((text) => text.lang === "ur")?.body as string).split("\n")[0]).not.toBe("Exercise. Practice only.");
    // No number is in a delivery row or in an audit record.
    const stored = JSON.stringify([await sql`select * from delivery where entry_id = ${ref.entryId}`, await sql`select * from audit_event where id > ${auditMark}`]);
    for (const number of ["4165550123", "6475550199"]) expect(stored).not.toContain(number);

    // The Drills page shows the drill with what became of its texts, per member and language (SMS_MODE=log: the texts are waiting, or already logged and never sent).
    await page.goto("/staff/drills");
    await expect(page.getByTestId("drill")).toHaveCount(1);
    await expect(page.getByTestId("drill-entries")).toContainText("Acknowledgement (approved)");
    await expect(page.getByTestId("drill-result-row")).toHaveCount(2);
    await expect(page.getByTestId("drill-results")).toContainText("Hub phone");
    await expect(page.getByTestId("drill-results")).toContainText("Priya");
    await expect(page.getByTestId("drill-results")).toContainText("Handed off: 0");
    await expect(page.getByTestId("drill-results")).toContainText("Unknown: 0");
    await expectNoHorizontalScroll(page);

    // The Hub home lists it in its own section, and the resident surface knows nothing of it: the share link is a 404.
    await page.goto("/staff");
    await expect(page.getByTestId("incidents-drills")).toContainText("Drills");
    const slug = (await sql`select slug from alert where id = ${ref.alertId}`)[0].slug as string;
    for (const address of [`/a/${slug}`, `/en/alerts/${slug}`]) {
      const response = await page.request.get(address, { maxRedirects: 0 });
      expect(response.status(), address).toBe(404);
    }
    const feed = await (await page.request.get("/api/feed?lang=en")).text();
    expect(feed).not.toContain(slug);
  } finally {
    await phone.context.close();
  }
});

test("a Coordinator is told only an Admin can run drills, has no menu item, and a direct post of each action is refused and audited", async ({ page, browser, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const coordinator: Person = await newCoordinator(sql, "coordinator");
  await signIn(page, coordinator);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Drills" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.goto("/staff/drills");
  await expect(page.getByText("Only an Admin can run drills.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a drill" })).toHaveCount(0);
  await page.goto("/staff/drills/roster");
  await expect(page.getByText("Only an Admin can change the drill roster.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add phone" })).toHaveCount(0);
  await page.goto("/staff/drills/start");
  await expect(page.getByText("Only an Admin can start a drill.")).toBeVisible();

  // The Admin's own pages name the actions' ids in their forms; a Coordinator who posts them directly is refused, before anything is written.
  const adminContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();
  const admin = await newCoordinator(sql, "admin");
  await signIn(adminPage, admin);
  const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const fieldsOf = async (path: string, marker: string) => {
    const html = await (await adminPage.request.get(path)).text();
    const form = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([text]) => text).find((text) => text.includes(marker));
    if (!form) throw new Error(`no form with ${marker} on ${path}`);
    return [...form.matchAll(/<input\b[^>]*>/g)].flatMap(([tag]) => {
      const name = /\bname="([^"]*)"/.exec(tag)?.[1];
      return name === undefined ? [] : [[unescape(name), unescape(/\bvalue="([^"]*)"/.exec(tag)?.[1] ?? "")] as [string, string]];
    });
  };
  const addFields = await fieldsOf("/staff/drills/roster", 'name="number"');
  const startFields = await fieldsOf("/staff/drills/start", 'name="kind"');
  expect(addFields.some(([name]) => name.startsWith("$ACTION"))).toBe(true);
  expect(startFields.some(([name]) => name.startsWith("$ACTION"))).toBe(true);
  await adminContext.close();

  const post = async (path: string, fields: [string, string][], extra: [string, string][]) => {
    const body = new FormData();
    for (const [name, value] of [...fields, ...extra]) body.append(name, value);
    const response = await page.request.post(path, { multipart: body, headers: { origin: baseURL as string } });
    expect(response.status()).toBe(200);
  };
  await post("/staff/drills/roster", addFields, [["label", "Intruder"], ["number", "416-555-0100"], ["lang", "en"]]);
  await post("/staff/drills/start", startFields, [["type", "elevator"], ["scope", "neighbourhood"], ["reported-date", "2026-10-05"], ["reported-time", "09:30"]]);
  expect(await roster()).toEqual([]);
  expect(await sql`select id from alert where created_by = ${coordinator.id}`).toEqual([]);
  const denied = await sql`select meta from audit_event where id > ${auditMark} and action = 'permission.denied' and actor_staff_id = ${coordinator.id} order by id`;
  expect(denied.map((row) => row.meta)).toEqual([
    { status: 403, route: "/staff/drills/roster", permission: "drill.run", reason: "forbidden" },
    { status: 403, route: "/staff/drills/start", permission: "drill.run", reason: "forbidden" },
  ]);
});
