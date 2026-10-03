// Every staff route goes through the one guard (S01.07, AD-4). The routes are found on disk, so a
// new page, route handler or server action under src/app/staff or src/app/api/staff is covered
// the moment it exists: it fails here unless it is built with a guard wrapper (src/app/staff/guard.ts)
// and refuses a request without a session, and one at an earlier setup gate, before its own code.
// A privileged route or action (S01.10) also refuses a session below aal2 before its own code.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATE_PAGES, SETUP_GATES, type AssuranceLevel, type SetupGate } from "../src/contracts/staffAuth";
import { POLICY_ACTIONS, PRIVILEGED_ACTIONS, type StaffSession } from "../src/modules/identity";
import { findStaffSurface, routePathOf, staffSurfaceProblems } from "./helpers/staffSurface";

const session = vi.hoisted(() => ({ current: null as StaffSession | null }));
const audits = vi.hoisted(() => ({ unauthenticated: [] as unknown[][], outsideGate: [] as unknown[][], belowAal2: [] as unknown[][], policy: [] as unknown[][] }));
const unreachable = vi.hoisted(() => () => {
  throw new Error("the route's own code ran although the guard should have refused");
});

vi.mock("../src/app/staff/session", () => ({ currentStaffSession: async () => session.current }));
// The approval's guard reads who edited the entry named in the request (S04.07); here no entry is there, so the guard's facts are the neutral ones
// and what is under test is the session, the gate, the role and the authenticator level, before the action's own code.
vi.mock("../src/app/staff/alerts", () => ({ alerting: () => ({ getEntry: async () => null }), alertSubmitter: unreachable }));
// A rule that depends on the request's facts also loads the person's assignments; there are none to load here.
vi.mock("../src/app/staff/scope", () => ({ assignmentsOf: async () => [] }));
vi.mock("../src/app/staff/identity", () => ({
  identity: () => ({
    refuseUnauthenticated: async (...args: unknown[]) => void audits.unauthenticated.push(args),
    addPersonView: unreachable,
    addPerson: unreachable,
  }),
  staffAuth: () => ({
    refuseOutsideGate: async (...args: unknown[]) => void audits.outsideGate.push(args),
    refuseBelowAal2: async (...args: unknown[]) => void audits.belowAal2.push(args),
    refuseByPolicy: async (...args: unknown[]) => void audits.policy.push(args),
    changePassword: unreachable,
    startEnrolment: unreachable,
    verifyAuthenticatorCode: unreachable,
    reissueStartingPassword: unreachable,
    signIn: unreachable,
    signOut: unreachable,
  }),
  identityConfigured: () => true,
  requestAuthSessions: unreachable,
}));

const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "src", "app");
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** The only routes anyone may use without a session. */
const PUBLIC = new Set(["/staff/sign-in", "/api/staff/sign-in", "/api/staff/sign-out"]);

const surface = findStaffSurface(APP, path.join(ROOT, "src"));
const { pages, handlers, actionFiles } = surface;
const relative = (file: string) => path.relative(ROOT, file);
/** The URL path of a route file: its directory under src/app, without route groups. */
const routePath = (file: string) => routePathOf(APP, file);

/** An Admin's session at a gate; at the Hub it is aal2 unless `aal` says otherwise. */
const atGate = (gate: SetupGate, aal: AssuranceLevel = gate === "hub" ? "aal2" : "aal1"): StaffSession => ({
  staffId: "01900000-0000-7000-8000-000000000001",
  username: "jdoe",
  firstName: "Jane",
  lastName: "Doe",
  role: "admin",
  gate,
  sessionId: "a".repeat(64),
  aal,
});

/** True when a route with this access admits a session at `gate` (the guard's rule). */
const admits = (access: unknown, gate: SetupGate) => access === "any_gate" || access === gate || (Array.isArray(access) && access.includes(gate));

/** Runs a page and returns where it redirected to (it must redirect). */
async function redirectOf(page: (props: unknown) => unknown): Promise<string> {
  try {
    await page({});
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return digest.split(";")[2];
    throw error;
  }
  throw new Error("the page rendered instead of redirecting");
}

const jsonRequest = (url: string, method: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", host: "localhost" }, body: method === "GET" || method === "HEAD" ? undefined : "{}" });

beforeEach(() => {
  session.current = null;
  audits.unauthenticated.length = 0;
  audits.outsideGate.length = 0;
  audits.belowAal2.length = 0;
  audits.policy.length = 0;
});

describe("the staff routes on disk", () => {
  it("are found: every page, route handler and server action file", () => {
    expect(pages.map(relative).sort()).toEqual(
      expect.arrayContaining([
        "src/app/staff/page.tsx",
        "src/app/staff/people/page.tsx",
        "src/app/staff/setup/authenticator/page.tsx",
        "src/app/staff/setup/password/page.tsx",
        "src/app/staff/sign-in/code/page.tsx",
        "src/app/staff/sign-in/page.tsx",
      ]),
    );
    expect(handlers.map(routePath).sort()).toEqual(
      expect.arrayContaining(["/api/staff/factor/enrol", "/api/staff/factor/verify", "/api/staff/me", "/api/staff/password", "/api/staff/sign-in", "/api/staff/sign-out"]),
    );
    expect(actionFiles.map(relative)).toContain("src/app/staff/people/actions.ts");
  });

  it("have nothing the guard cannot cover: unwrappable route files, metadata routes, inline actions, generateMetadata", () => {
    expect(staffSurfaceProblems(surface)).toEqual([]);
  });
});

describe.each([...pages, ...surface.layouts].map((file) => [relative(file), file]))("page or layout %s", (_name, file) => {
  it("exports no function Next.js would call outside the guard (generateMetadata and the like)", async () => {
    const exportsOf: Record<string, unknown> = await import(file);
    const functions = Object.entries(exportsOf).filter(([name, value]) => name !== "default" && typeof value === "function");
    expect(functions.map(([name]) => name)).toEqual([]);
  });
});

/** A throwaway src/ tree: `files` maps paths under it to their text. */
function fixture(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "cvh-staff-surface-"));
  for (const [name, text] of Object.entries(files)) {
    const full = path.join(root, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  const src = (name: string) => path.join(root, name);
  return { surface: findStaffSurface(src("app"), root), src, remove: () => rmSync(root, { recursive: true, force: true }) };
}

const GUARDED_PAGE = `import { staffPage } from "@/app/staff/guard";\nexport default staffPage({ route: "/staff/x", access: "hub" }, () => null);\n`;

describe("the enumeration of the staff surface (fixtures that must make the checks above fail)", () => {
  it.each([
    "app/staff/icon.tsx",
    "app/staff/apple-icon.png",
    "app/staff/people/opengraph-image.tsx",
    "app/staff/people/twitter-image.jpg",
    "app/staff/sitemap.ts",
    "app/staff/manifest.ts",
    "app/staff/robots.txt",
    "app/api/staff/icon1.png",
    "app/(admin)/staff/opengraph-image.alt.txt",
  ])("flags the metadata route %s", (name) => {
    const { surface: found, remove } = fixture({ [name]: "export default function Image() { return null; }\n", "app/staff/page.tsx": GUARDED_PAGE });
    try {
      expect(found.metadata.map((file) => path.basename(file))).toEqual([path.basename(name)]);
      expect(staffSurfaceProblems(found)).toEqual([expect.stringMatching(/a metadata route under a staff URL/)]);
    } finally {
      remove();
    }
  });

  it("does not flag metadata routes outside the staff URLs", () => {
    const { surface: found, remove } = fixture({ "app/icon.png": "", "app/(site)/opengraph-image.tsx": "export default () => null;\n", "app/staff/page.tsx": GUARDED_PAGE });
    try {
      expect(staffSurfaceProblems(found)).toEqual([]);
    } finally {
      remove();
    }
  });

  it("flags a function-level \"use server\" action in a staff file, or in a component a staff page imports", () => {
    const { surface: found, remove } = fixture({
      "app/staff/page.tsx": `import { Panel } from "@/components/Panel";\nexport default async function Page() {\n  async function act() {\n    "use server";\n  }\n  return null;\n}\n`,
      "components/Panel.tsx": `export function Panel() {\n  const save = async () => {\n    'use server';\n  };\n  return null;\n}\n`,
      "components/Unused.tsx": `export function Unused() {\n  async function act() {\n    "use server";\n  }\n}\n`,
    });
    try {
      expect(found.inlineActions.map((file) => path.relative(path.dirname(found.appDir), file)).sort()).toEqual(["app/staff/page.tsx", "components/Panel.tsx"]);
      expect(staffSurfaceProblems(found)).toEqual([
        expect.stringMatching(/app\/staff\/page\.tsx: an inline "use server" action/),
        expect.stringMatching(/components\/Panel\.tsx: an inline "use server" action/),
      ]);
    } finally {
      remove();
    }
  });

  it("finds \"use server\" files anywhere that staff pages import, directly or through another module, so each is checked as staff actions", () => {
    const { surface: found, src, remove } = fixture({
      "app/staff/people/page.tsx": `import { thing } from "../../shared/forms";\nexport default function Page() { return null; }\n`,
      "app/shared/forms.ts": `export { save } from "@/app/lib/actions";\nexport const thing = 1;\n`,
      "app/lib/actions.ts": `// Saves things.\n"use server";\nexport async function save() {}\n`,
      "app/lib/elsewhere.ts": `"use server";\nexport async function notImportedByStaff() {}\n`,
      "app/staff/own.ts": `'use server'\nexport async function own() {}\n`,
    });
    try {
      expect(found.actionFiles.sort()).toEqual([src("app/lib/actions.ts"), src("app/staff/own.ts")]);
    } finally {
      remove();
    }
  });

  it("finds pages, handlers and route files of route groups that resolve under /staff", () => {
    const { surface: found, src, remove } = fixture({
      "app/(x)/staff/hidden/page.tsx": "export default function Page() { return null; }\n",
      "app/(x)/api/staff/hidden/route.ts": "export async function GET() { return new Response(); }\n",
      "app/(x)/staff/loading.tsx": "export default function Loading() { return null; }\n",
      "app/(x)/staff/route.ts": "export async function GET() { return new Response(); }\n",
      "app/(x)/staffing/page.tsx": "export default function Page() { return null; }\n",
    });
    try {
      expect(found.pages).toEqual([src("app/(x)/staff/hidden/page.tsx")]);
      expect(routePathOf(found.appDir, found.pages[0])).toBe("/staff/hidden");
      expect(found.handlers.sort()).toEqual([src("app/(x)/api/staff/hidden/route.ts"), src("app/(x)/staff/route.ts")]);
      expect(staffSurfaceProblems(found)).toEqual([
        expect.stringMatching(/app\/\(x\)\/staff\/loading\.tsx: a route file the guard cannot wrap/),
        expect.stringMatching(/app\/\(x\)\/staff\/route\.ts: a route handler outside \/api\/staff/),
      ]);
    } finally {
      remove();
    }
  });

  it.each([
    ["an async function", "export async function generateMetadata() { return {}; }"],
    ["a const", "export const generateMetadata = async () => ({});"],
    ["a re-export", "async function generateMetadata() { return {}; }\nexport { generateMetadata };"],
    ["generateViewport", "export function generateViewport() { return {}; }"],
  ])("flags generateMetadata and the like on a staff page or layout, as %s", (_name, code) => {
    const { surface: found, remove } = fixture({ "app/staff/people/page.tsx": `${GUARDED_PAGE}${code}\n`, "app/staff/layout.tsx": `export default function L() { return null; }\n${code}\n` });
    try {
      expect(staffSurfaceProblems(found)).toEqual([
        expect.stringMatching(/app\/staff\/layout\.tsx: exports generate(Metadata|Viewport), which Next.js calls outside the guard/),
        expect.stringMatching(/app\/staff\/people\/page\.tsx: exports generate(Metadata|Viewport), which Next.js calls outside the guard/),
      ]);
    } finally {
      remove();
    }
  });
});

describe.each(pages.map((file) => [relative(file), file]))("page %s", (_name, file) => {
  it("is built with the guard, for its own route, and is public only if allow-listed", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const spec = guardSpecOf((await import(file)).default);
    expect(spec, "default export is not a guarded page").toBeDefined();
    expect(spec?.route).toBe(routePath(file));
    expect(spec?.access === "public").toBe(PUBLIC.has(routePath(file)));
    if (spec?.access !== "public") expect(POLICY_ACTIONS, "a guarded page names its policy action (S01.12)").toContain(spec?.action);
  });

  it("sends a visitor without a session to sign-in, and a session at another gate to that gate's page", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const page = (await import(file)).default;
    const spec = guardSpecOf(page);
    if (!spec || spec.access === "public") return;
    expect(await redirectOf(page)).toBe("/staff/sign-in");
    for (const gate of SETUP_GATES) {
      if (admits(spec.access, gate)) continue;
      session.current = atGate(gate);
      expect(await redirectOf(page), `${gate}`).toBe(GATE_PAGES[gate]);
    }
    expect(spec.privileged, "a page is never privileged: its actions are").toBeUndefined();
  });
});

describe.each(handlers.map((file) => [routePath(file), file]))("route handler %s", (route, file) => {
  it("exports only guarded handlers, for its own route, public only if allow-listed", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const exportsOf: Record<string, unknown> = await import(file);
    const methods = HTTP_METHODS.filter((method) => method in exportsOf);
    expect(methods.length).toBeGreaterThan(0);
    for (const method of methods) {
      const spec = guardSpecOf(exportsOf[method]);
      expect(spec, `${method} is not a guarded handler`).toBeDefined();
      expect(spec?.route).toBe(route);
      expect(spec?.access === "public").toBe(PUBLIC.has(route));
      if (spec?.access !== "public") expect(POLICY_ACTIONS, `${method} names its policy action (S01.12)`).toContain(spec?.action);
    }
  });

  it("answers 401 without a session and 403 setup_incomplete at another gate, before its own code, and audits both", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const exportsOf: Record<string, unknown> = await import(file);
    for (const method of HTTP_METHODS.filter((name) => name in exportsOf)) {
      const handler = exportsOf[method] as (request: Request) => Promise<Response>;
      const spec = guardSpecOf(handler);
      if (!spec || spec.access === "public") continue;
      session.current = null;
      const unauthenticated = await handler(jsonRequest(route, method));
      expect(unauthenticated.status).toBe(401);
      expect(await unauthenticated.json()).toEqual({ error: "unauthenticated" });
      expect(unauthenticated.headers.get("cache-control")).toBe("no-store");
      expect(audits.unauthenticated.at(-1)).toEqual([spec.action, route]);
      for (const gate of SETUP_GATES) {
        if (admits(spec.access, gate)) continue;
        session.current = atGate(gate);
        const refused = await handler(jsonRequest(route, method));
        expect(refused.status, gate).toBe(403);
        expect(await refused.json()).toEqual({ error: "setup_incomplete" });
        expect(audits.outsideGate.at(-1)).toEqual([atGate(gate).staffId, route]);
      }
    }
  });

  it("answers 403 aal2_required to a session below aal2 when privileged, before its own code, and audits it", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const exportsOf: Record<string, unknown> = await import(file);
    for (const method of HTTP_METHODS.filter((name) => name in exportsOf)) {
      const handler = exportsOf[method] as (request: Request) => Promise<Response>;
      const spec = guardSpecOf(handler);
      if (!spec?.privileged) continue;
      expect(PRIVILEGED_ACTIONS).toContain(spec.privileged);
      for (const gate of SETUP_GATES.filter((candidate) => admits(spec.access, candidate))) {
        session.current = atGate(gate, "aal1");
        const refused = await handler(jsonRequest(route, method));
        expect(refused.status, gate).toBe(403);
        expect(await refused.json()).toEqual({ error: "aal2_required" });
        expect(audits.belowAal2.at(-1)).toEqual([atGate(gate).staffId, route, spec.privileged]);
      }
    }
  });
});

const GENERIC_AAL2_MESSAGE = "This needs a sign-in confirmed with an authenticator code. Only Admins and Coordinators can do it, after entering their code.";
/** Actions only an Admin may take say so: an Admin at aal1 is not told that Coordinators can do it (S02.04 review). */
const AAL2_MESSAGE: Record<string, string> = {
  "src/app/staff/providers/actions.ts": "An Admin must sign in with their authenticator code to change providers. Sign in again and enter the code.",
  "src/app/staff/coverage/actions.ts": "An Admin must sign in with their authenticator code to assign ambassadors. Sign in again and enter the code.",
  "src/app/staff/directory/actions.ts": "An Admin must sign in with their authenticator code to publish the directory. Sign in again and enter the code.",
  "src/app/staff/alerts/approval/actions.ts": "Approving needs a sign-in confirmed with your authenticator. Sign out, sign in again and enter your code.",
};
/** What a role the policy refuses is told, where it is not "Only an Admin can ...": a Coordinator can approve too, but not what they wrote or changed (S04.07). */
const FORBIDDEN_MESSAGE: Record<string, RegExp> = {
  "src/app/staff/alerts/approval/actions.ts": /^Only a Coordinator or an Admin who did not write or change this alert can approve it\./,
};

describe.each(actionFiles.map((file) => [relative(file), file]))("server actions in %s", (_name, file) => {
  it("are all guarded and none is public", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const exportsOf: Record<string, unknown> = await import(file);
    const exported = Object.entries(exportsOf);
    expect(exported.length).toBeGreaterThan(0);
    for (const [name, value] of exported) {
      const spec = guardSpecOf(value);
      expect(spec, `${name} is not a guarded action`).toBeDefined();
      expect(spec?.access).not.toBe("public");
      expect(POLICY_ACTIONS, `${name} names its policy action (S01.12)`).toContain(spec?.action);
    }
  });

  it("send a person without a session to sign-in, and refuse at another gate, before their own code", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const exportsOf: Record<string, (...args: unknown[]) => Promise<{ status: string; message?: string }>> = await import(file);
    for (const [name, action] of Object.entries(exportsOf)) {
      const spec = guardSpecOf(action);
      if (!spec || spec.access === "public") continue;
      session.current = null;
      expect(await redirectOf(() => action({ status: "idle" }, new FormData())), name).toBe("/staff/sign-in");
      expect(audits.unauthenticated.at(-1), name).toEqual([spec.action, spec.route]);
      for (const gate of SETUP_GATES) {
        if (admits(spec.access, gate)) continue;
        session.current = atGate(gate);
        expect(await action({ status: "idle" }, new FormData()), `${name} at ${gate}`).toMatchObject({
          status: "refused",
          message: "Finish setting up your account first.",
        });
      }
    }
  });

  it("refuse a session below aal2 when privileged (403 aal2_required) for a role the policy allows, and any other role as forbidden, before their own code", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const { can } = await import("../src/modules/identity");
    const exportsOf: Record<string, (...args: unknown[]) => Promise<{ status: string; message?: string }>> = await import(file);
    for (const [name, action] of Object.entries(exportsOf)) {
      const spec = guardSpecOf(action);
      if (!spec?.privileged) continue;
      expect(PRIVILEGED_ACTIONS).toContain(spec.privileged);
      for (const role of ["admin", "coordinator", "director", "ambassador"] as const) {
        for (const gate of SETUP_GATES.filter((candidate) => admits(spec.access, candidate))) {
          session.current = { ...atGate(gate, "aal1"), role };
          const answer = await action({ status: "idle" }, new FormData());
          // A rule that depends on the entry (approval: not an editor of it) is asked with the neutral entry the mocked reader returns for "none".
          if (can(role, spec.privileged, { actorId: atGate(gate).staffId, entry: { authorId: "00000000-0000-0000-0000-000000000000", editorIds: [], status: "pending_approval" } })) {
            expect(answer, `${name} as ${role} at ${gate}`).toMatchObject({
              status: "refused",
              message: AAL2_MESSAGE[relative(file)] ?? GENERIC_AAL2_MESSAGE,
            });
            expect(audits.belowAal2.at(-1)).toEqual([atGate(gate).staffId, spec.route, spec.privileged]);
          } else {
            expect(answer, `${name} as ${role} at ${gate}`).toMatchObject({ status: "refused", message: expect.stringMatching(FORBIDDEN_MESSAGE[relative(file)] ?? /^Only an Admin can /) });
            expect(audits.policy.at(-1)).toEqual([atGate(gate).staffId, spec.route, spec.privileged, "forbidden"]);
          }
        }
      }
    }
  });
});

describe("privileged actions (S01.10: account changes run only at aal2)", () => {
  it("are Add a person, Re-issue, Reset password and Reset authenticator, each marked accounts.manage", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const exportsOf: Record<string, unknown> = await import("../src/app/staff/people/actions");
    const marked = Object.entries(exportsOf).map(([name, value]) => [name, guardSpecOf(value)?.privileged]);
    expect(Object.fromEntries(marked)).toEqual({
      addPersonAction: "accounts.manage",
      reissueAction: "accounts.manage",
      resetPasswordAction: "accounts.manage",
      resetAuthenticatorAction: "accounts.manage",
    });
  });

  it("include S01.14's assign and remove an Ambassador's assignment, each marked accounts.manage", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const exportsOf: Record<string, unknown> = await import("../src/app/staff/coverage/actions");
    const marked = Object.entries(exportsOf).map(([name, value]) => [name, guardSpecOf(value)?.privileged]);
    expect(Object.fromEntries(marked)).toEqual({ assignAmbassadorAction: "accounts.manage", removeAssignmentAction: "accounts.manage" });
  });

  it("let an aal2 session through to the action's own code", async () => {
    const { addPersonAction } = await import("../src/app/staff/people/actions");
    session.current = atGate("hub", "aal2");
    // The mocked module throws when the action's own code runs: the guard let it through.
    await expect(addPersonAction({ status: "idle" }, new FormData())).rejects.toThrow(/the route's own code ran/);
    expect(audits.belowAal2).toEqual([]);
  });
});

/** Every page and call a session at `gate` can reach (public calls included). */
async function reachableAt(gate: SetupGate): Promise<string[]> {
  const { guardSpecOf } = await import("../src/app/staff/guard");
  const reachable: string[] = [];
  for (const file of pages) {
    const spec = guardSpecOf((await import(file)).default);
    if (spec && spec.access !== "public" && admits(spec.access, gate)) reachable.push(`page ${spec.route}`);
  }
  for (const file of handlers) {
    const exportsOf: Record<string, unknown> = await import(file);
    for (const method of HTTP_METHODS.filter((name) => name in exportsOf)) {
      const spec = guardSpecOf(exportsOf[method]);
      if (spec && (spec.access === "public" || admits(spec.access, gate))) reachable.push(`${method} ${spec.route}`);
    }
  }
  return reachable.sort();
}

describe("the setup sequence's gates", () => {
  it("gate 1 leaves only Choose your password, POST /api/staff/password, GET /api/staff/me and sign-out reachable", async () => {
    expect(await reachableAt("choose_password")).toEqual([
      "GET /api/staff/me",
      "POST /api/staff/password",
      "POST /api/staff/sign-in",
      "POST /api/staff/sign-out",
      "page /staff/setup/password",
    ]);
  });

  it("gate 2 leaves only the enrolment page, POST /api/staff/factor/enrol and /verify, GET /api/staff/me and sign-out reachable", async () => {
    expect(await reachableAt("enrol_authenticator")).toEqual([
      "GET /api/staff/me",
      "POST /api/staff/factor/enrol",
      "POST /api/staff/factor/verify",
      "POST /api/staff/sign-in",
      "POST /api/staff/sign-out",
      "page /staff/setup/authenticator",
    ]);
  });

  it("the code gate after the password leaves only the code page, POST /api/staff/factor/verify, GET /api/staff/me and sign-out reachable", async () => {
    expect(await reachableAt("authenticator_code")).toEqual([
      "GET /api/staff/me",
      "POST /api/staff/factor/verify",
      "POST /api/staff/sign-in",
      "POST /api/staff/sign-out",
      "page /staff/sign-in/code",
    ]);
  });
});

describe("cross-site calls", () => {
  it("are refused before the session is read: another origin, or a body that is not JSON", async () => {
    const { POST } = await import("../src/app/api/staff/password/route");
    session.current = atGate("choose_password");
    const foreign = new Request("http://localhost/api/staff/password", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost", origin: "https://evil.example" },
      body: "{}",
    });
    expect((await POST(foreign)).status).toBe(403);
    const form = new Request("http://localhost/api/staff/password", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", host: "localhost" }, body: "a=b" });
    expect((await POST(form)).status).toBe(415);
  });
});
