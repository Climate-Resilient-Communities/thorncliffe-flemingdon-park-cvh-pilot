// The Hub and partner space's pages and actions (2026-11-07), called through their real guard on the seeded dummy data, as the app's own
// database role: every page renders for the roles that see it (cards, pills and tables, not bare text), a Director reads without the forms,
// an Ambassador is refused, and a Coordinator's change of a space goes back to its page with the notice, reaches what residents are shown and
// is refused for a Director.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { parsePartnerSeed, readSpace, residentSpaces, seedPartners } from "../../src/modules/partners";
import { createDb, type Db } from "../../src/platform/db";
import { ROOT, connect, serverUrl } from "./helpers";

type Role = "ambassador" | "coordinator" | "director" | "admin";

/** The session the guard reads and the database the pages use: the test's. The guard, the role policy and the pages are the real ones. */
const wired = vi.hoisted(() => ({ db: null as unknown, session: null as unknown }));
vi.mock("../../src/app/staff/identity", () => ({
  identityConfigured: () => true,
  requestAuthSessions: async () => ({}),
  staffAuth: () => ({ currentSession: async () => wired.session, refuseByPolicy: async () => undefined }),
  identity: () => ({}),
}));
vi.mock("../../src/app/staff/scope", () => ({ assignmentsOf: async () => [] }));
vi.mock("../../src/app/staff/partners/db", () => ({ partnersDb: () => wired.db }));
// Outside a Next request there is no cache to revalidate; what the action asks to revalidate is recorded.
const revalidated = vi.hoisted(() => ({ tags: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: (tag: string) => void revalidated.tags.push(tag) }));

const SEED = parsePartnerSeed(JSON.parse(readFileSync(path.join(ROOT, "data", "partners", "seed.json"), "utf8")));

const PAGES = [
  "partners/page",
  "partners/open/page",
  "partners/our-spaces/page",
  "partners/coverage/page",
  "partners/capacity/page",
  "partners/supplies/page",
  "partners/decisions/page",
  "partners/handover/page",
  "readiness/page",
  "readiness/playbooks/page",
  "readiness/teams/page",
  "readiness/exercises/page",
  "readiness/indicators/page",
  "readiness/look-back/page",
] as const;

describe("the Hub and partner space's pages (2026-11-07)", () => {
  let sql: ReturnType<typeof connect>;
  let owner: Db;
  let app: Db;
  const people: Partial<Record<Role, string>> = {};

  beforeAll(async () => {
    sql = connect(serverUrl());
    await migrate({ sql });
    const password = randomBytes(18).toString("hex");
    await sql.unsafe(`alter role cvh_app_login password '${password}'`);
    const url = new URL(serverUrl());
    url.username = "cvh_app_login";
    url.password = password;
    owner = createDb(serverUrl());
    app = createDb(url.href);
    wired.db = app;
    for (const role of ["ambassador", "coordinator", "director", "admin"] as const) {
      people[role] = randomUUID();
      await sql`
        insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
        values (${people[role]!}, ${randomUUID()}, ${`${role.slice(0, 5)}${randomBytes(3).toString("hex")}`}, 'Rosa', ${role}, 'someone@example.org', ${role}, false)`;
    }
  });

  afterAll(async () => {
    await sql.unsafe(
      "delete from partner_statement; delete from partner_decision; delete from partner_handover; delete from shared_space; delete from partner_commitment; delete from partner_supply; delete from playbook; delete from partner_team; delete from partner_exercise; delete from partner_indicator; delete from look_back_record; delete from look_back_action; delete from space_change; delete from space; delete from partner_org",
    );
    await sql.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await sql`delete from audit_event where actor_staff_id = any(${Object.values(people)})`;
    await sql.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await sql`delete from staff_account where id = any(${Object.values(people)})`;
    await sql.unsafe("alter role cvh_app_login password null");
    await app.$client.end({ timeout: 5 });
    await owner.$client.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await seedPartners(owner, SEED, { resetStatus: true });
    revalidated.tags = [];
  });

  const as = (role: Role) => {
    wired.session = { staffId: people[role], sessionId: randomUUID(), username: role, firstName: "Rosa", lastName: "Medina", role, gate: "hub", aal: role === "coordinator" || role === "admin" ? "aal2" : "aal1" };
  };

  /** A page through its guard: its markup, or where it sends the person. */
  async function open(file: string, props: Record<string, unknown> = {}) {
    const { default: page } = (await import(`../../src/app/staff/${file}`)) as { default: (props: unknown) => Promise<ReactNode> };
    try {
      return { html: renderToStaticMarkup(await page({ searchParams: Promise.resolve({}), ...props })) };
    } catch (error) {
      const digest = (error as { digest?: unknown }).digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return { redirect: digest.split(";")[2] };
      throw error;
    }
  }

  /** A server action through its guard, posted as its form posts it: where it sends the person back to. */
  async function post(name: "changeSpaceAction" | "setSpaceStatusAction", fields: Record<string, string>) {
    const actions = (await import("../../src/app/staff/partners/actions")) as unknown as Record<string, (state: unknown, form: FormData) => Promise<unknown>>;
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    try {
      return { state: await actions[name]({ status: "idle" }, form) };
    } catch (error) {
      const digest = (error as { digest?: unknown }).digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return { redirect: digest.split(";")[2] };
      throw error;
    }
  }

  it.each(PAGES)("renders %s for a Coordinator with the area's band, as cards, pills or tables", async (file) => {
    as("coordinator");
    const { html } = await open(file);
    expect(html).toContain("data-testid=\"area-band\"");
    expect(html).toMatch(/hub-card|hub-table|hub-pill/);
  });

  it("shows every space on the status board with its status as a word and who confirmed it when", async () => {
    as("director");
    const { html } = await open("partners/page");
    expect(html).toContain("Jenner Jean-Marie Community Centre");
    expect(html).toMatch(/data-testid="status-SP04"[^>]*>Full</);
    expect(html).toContain("Confirmed 50 minutes ago by Kwame O., the City");
    // SP05 was last confirmed 410 minutes ago: flagged, as residents are told to call first.
    expect(html).toMatch(/Not confirmed for 7 hours/);
    expect(html).toContain("We can bring 40 power banks from our depot.");
  });

  it("gives a Director the pages without a form, and a Coordinator the forms", async () => {
    as("director");
    expect((await open("partners/spaces/[id]/page", { params: Promise.resolve({ id: "SP03" }) })).html).not.toContain("<form");
    expect((await open("partners/open/page")).html).not.toContain("<form");
    as("coordinator");
    expect((await open("partners/spaces/[id]/page", { params: Promise.resolve({ id: "SP03" }) })).html).toContain("Save and confirm");
    expect((await open("partners/open/page")).html).toContain("Open this space");
  });

  it("refuses an Ambassador every page of the area", async () => {
    as("ambassador");
    for (const file of PAGES) expect((await open(file)).html, file).toContain("Only a Coordinator, a Director or an Admin can see the partner space.");
  });

  it("opens a space for a Coordinator, back on the page it came from with the notice, and residents are shown it", async () => {
    as("coordinator");
    const result = await post("changeSpaceAction", { spaceId: "SP08", back: "/staff/partners/open", status: "open", purpose: "warming", capacityMax: "80", capacityNow: "" });
    expect(result.redirect).toBe("/staff/partners/open?space=SP08&done=saved#space-SP08");
    expect((await readSpace(app, "SP08"))?.space).toMatchObject({ status: "open", purpose: "warming", confirmedBy: "Rosa Medina, the Hub" });
    expect((await residentSpaces(app)).some((s) => s.providerId === "M055")).toBe(true);
    expect(revalidated.tags).toEqual(["resident-spaces"]);
    const { html } = await open("partners/open/page", { searchParams: Promise.resolve({ space: "SP08", done: "saved" }) });
    expect(html).toContain("Angela James Arena is Open.");
  });

  it("sets P-07's one-tap status from the space as it is, and goes back with a refusal it can show", async () => {
    as("admin");
    expect((await post("setSpaceStatusAction", { spaceId: "SP02", back: "/staff/partners/our-spaces?org=TNO", status: "full" })).redirect).toBe(
      "/staff/partners/our-spaces?org=TNO&space=SP02&done=saved#space-SP02",
    );
    expect((await readSpace(app, "SP02"))?.space).toMatchObject({ status: "full", purpose: "charging", capacityNow: 9, capacityMax: 25 });
    expect((await post("changeSpaceAction", { spaceId: "SP02", back: "/staff/partners/spaces/SP02", status: "open", purpose: "charging", capacityMax: "25", capacityNow: "30" })).redirect).toBe(
      "/staff/partners/spaces/SP02?space=SP02&error=capacity_over#space-SP02",
    );
    // A page outside the area is never where a change goes back to.
    expect((await post("setSpaceStatusAction", { spaceId: "SP02", back: "https://example.org/x", status: "confirm" })).redirect).toBe("/staff/partners?space=SP02&done=saved#space-SP02");
  });

  it("refuses a Director's change and changes nothing", async () => {
    as("director");
    const result = await post("changeSpaceAction", { spaceId: "SP03", back: "/staff/partners", status: "closed", purpose: "warming", capacityMax: "60", capacityNow: "" });
    expect(result.state).toEqual({ status: "refused", message: "Only a Coordinator or an Admin can change a space. Nothing was changed." });
    expect((await readSpace(app, "SP03"))?.space.status).toBe("open");
  });
});
