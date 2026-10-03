import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffSession } from "./session";

// A page's guard with the facts of its request (S04.07): the approval view is for someone who is not an editor of the entry, which only the
// database knows. The session store and the composition root are not needed.
const current = vi.hoisted(() => ({ session: null as StaffSession | null }));
vi.mock("./identity", () => ({ identity: () => null, staffAuth: () => null }));
vi.mock("./scope", () => ({ assignmentsOf: async () => [] }));
vi.mock("./session", () => ({ currentStaffSession: async () => current.session }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  },
}));

import { PolicyRefusal, staffPage, type PolicyFacts } from "./guard";

const ME = "01900000-0000-7000-8000-000000000001";
const OTHER = "01900000-0000-7000-8000-000000000002";
const session = (overrides: Partial<StaffSession> = {}): StaffSession => ({
  staffId: ME,
  sessionId: "a".repeat(64),
  username: "aokafor",
  firstName: "Ann",
  lastName: "Okafor",
  role: "coordinator",
  gate: "hub",
  aal: "aal2",
  ...overrides,
});

const entryEditedBy = (...editors: string[]): PolicyFacts => ({ entry: { authorId: editors[0], editorIds: editors, status: "pending_approval" } });

function page(read: (session: StaffSession, props: { id: string }) => Promise<PolicyFacts>) {
  const render = vi.fn(() => "the page");
  const refused = vi.fn(() => "the refusal");
  const context = vi.fn(read);
  const built = staffPage({ route: "/staff/alerts/approve", access: "hub", action: "alert.approve", refused, context }, render);
  return { built, render, refused, context };
}

const marked = (answer: unknown) => (answer as { type?: unknown } | null)?.type === PolicyRefusal;

beforeEach(() => {
  current.session = session();
});

describe("a staff page with the facts of its request", () => {
  it("renders for a Coordinator or an Admin who is not an editor of the entry the request names, with the session", async () => {
    const p = page(async () => entryEditedBy(OTHER));
    expect(await p.built({ id: "x" })).toBe("the page");
    expect(p.context).toHaveBeenCalledWith(expect.objectContaining({ staffId: ME }), { id: "x" });
    expect(p.render).toHaveBeenCalledWith(expect.objectContaining({ staffId: ME, role: "coordinator" }), { id: "x" });
    current.session = session({ role: "admin" });
    expect(await p.built({ id: "x" })).toBe("the page");
  });

  it("shows the refusal view instead of the page to an editor of the entry, the author included, and never runs the page", async () => {
    for (const editors of [[ME], [OTHER, ME]]) {
      const p = page(async () => entryEditedBy(...editors));
      expect(marked(await p.built({ id: "x" })), editors.join()).toBe(true);
      expect(p.refused).toHaveBeenCalledTimes(1);
      expect(p.render).not.toHaveBeenCalled();
    }
  });

  it("shows the refusal view when the facts cannot be read (a bad request), and never runs the page", async () => {
    const p = page(async () => {
      throw new Error("no such entry");
    });
    expect(marked(await p.built({ id: "x" }))).toBe(true);
    expect(p.render).not.toHaveBeenCalled();
  });

  it("refuses a Director and an Ambassador on their role alone, without reading the entry", async () => {
    for (const role of ["director", "ambassador"] as const) {
      current.session = session({ role, aal: "aal1" });
      const p = page(async () => entryEditedBy(OTHER));
      expect(marked(await p.built({ id: "x" })), role).toBe(true);
      expect(p.context, role).not.toHaveBeenCalled();
      expect(p.render).not.toHaveBeenCalled();
    }
  });

  it("sends a person without a session to sign-in and reads nothing", async () => {
    current.session = null;
    const p = page(async () => entryEditedBy(OTHER));
    await expect(p.built({ id: "x" })).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/staff/sign-in;307;" });
    expect(p.context).not.toHaveBeenCalled();
  });

  it("does not ask the page for aal2: a page shows, and the actions on it are asked", async () => {
    current.session = session({ aal: "aal1" });
    const p = page(async () => entryEditedBy(OTHER));
    expect(await p.built({ id: "x" })).toBe("the page");
  });
});
