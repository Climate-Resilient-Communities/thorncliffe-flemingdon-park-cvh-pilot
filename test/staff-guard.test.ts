// Every staff route goes through the one guard (S01.07, AD-4). The routes are found on disk, so a
// new page, route handler or server action under src/app/staff or src/app/api/staff is covered
// the moment it exists: it fails here unless it is built with a guard wrapper (src/app/staff/guard.ts)
// and refuses a request without a session, and one at an earlier setup gate, before its own code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATE_PAGES, type SetupGate } from "../src/contracts/staffAuth";
import type { StaffSession } from "../src/modules/identity";

const session = vi.hoisted(() => ({ current: null as StaffSession | null }));
const audits = vi.hoisted(() => ({ unauthenticated: [] as unknown[][], outsideGate: [] as unknown[][] }));
const unreachable = vi.hoisted(() => () => {
  throw new Error("the route's own code ran although the guard should have refused");
});

vi.mock("../src/app/staff/session", () => ({ currentStaffSession: async () => session.current }));
vi.mock("../src/app/staff/identity", () => ({
  identity: () => ({
    refuseUnauthenticated: async (...args: unknown[]) => void audits.unauthenticated.push(args),
    addPersonView: unreachable,
    addPerson: unreachable,
  }),
  staffAuth: () => ({
    refuseOutsideGate: async (...args: unknown[]) => void audits.outsideGate.push(args),
    changePassword: unreachable,
    reissueStartingPassword: unreachable,
    signIn: unreachable,
    signOut: unreachable,
  }),
  identityConfigured: () => true,
  requestAuthSessions: unreachable,
}));

const ROOT = path.join(__dirname, "..");
const STAFF_DIRS = [path.join(ROOT, "src", "app", "staff"), path.join(ROOT, "src", "app", "api", "staff")];
const ROUTE_FILE = /^(page|route|layout|template|default|loading|error|not-found)\.(tsx?|jsx?)$/;
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** The only routes anyone may use without a session. */
const PUBLIC = new Set(["/staff/sign-in", "/api/staff/sign-in", "/api/staff/sign-out"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = STAFF_DIRS.flatMap(walk).filter((file) => /\.(tsx?|jsx?)$/.test(file) && !/\.test\.(tsx?|jsx?)$/.test(file));
const relative = (file: string) => path.relative(ROOT, file);
/** The URL path of a route file: its directory under src/app, without route groups. */
const routePath = (file: string) =>
  "/" +
  path
    .relative(path.join(ROOT, "src", "app"), path.dirname(file))
    .split(path.sep)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join("/");

const pages = files.filter((file) => /\/page\.(tsx?|jsx?)$/.test(file));
const handlers = files.filter((file) => /\/route\.(tsx?|jsx?)$/.test(file));
const actionFiles = files.filter((file) => /^\s*["']use server["']/.test(readFileSync(file, "utf8")));
const otherRouteFiles = files.filter((file) => ROUTE_FILE.test(path.basename(file)) && !/\/(page|route|layout)\.(tsx?|jsx?)$/.test(file));

const atGate = (gate: SetupGate): StaffSession => ({
  staffId: "01900000-0000-7000-8000-000000000001",
  username: "jdoe",
  firstName: "Jane",
  lastName: "Doe",
  role: "admin",
  gate,
});

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
});

describe("the staff routes on disk", () => {
  it("are found: every page, route handler and server action file", () => {
    expect(pages.map(relative).sort()).toEqual(
      expect.arrayContaining(["src/app/staff/page.tsx", "src/app/staff/people/page.tsx", "src/app/staff/setup/password/page.tsx", "src/app/staff/sign-in/page.tsx"]),
    );
    expect(handlers.map(routePath).sort()).toEqual(expect.arrayContaining(["/api/staff/me", "/api/staff/password", "/api/staff/sign-in", "/api/staff/sign-out"]));
    expect(actionFiles.map(relative)).toContain("src/app/staff/people/actions.ts");
  });

  it("have no route files the guard cannot wrap (route.ts under /staff, templates, defaults, error pages)", () => {
    expect(otherRouteFiles.map(relative)).toEqual([]);
    expect(handlers.filter((file) => !file.includes(`${path.sep}api${path.sep}`)).map(relative)).toEqual([]);
  });
});

describe.each(pages.map((file) => [relative(file), file]))("page %s", (_name, file) => {
  it("is built with the guard, for its own route, and is public only if allow-listed", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const spec = guardSpecOf((await import(file)).default);
    expect(spec, "default export is not a guarded page").toBeDefined();
    expect(spec?.route).toBe(routePath(file));
    expect(spec?.access === "public").toBe(PUBLIC.has(routePath(file)));
  });

  it("sends a visitor without a session to sign-in, and a session at another gate to that gate's page", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const page = (await import(file)).default;
    const spec = guardSpecOf(page);
    if (!spec || spec.access === "public") return;
    expect(await redirectOf(page)).toBe("/staff/sign-in");
    for (const gate of ["choose_password", "enrol_authenticator", "hub"] as const) {
      if (spec.access === gate || spec.access === "any_gate") continue;
      session.current = atGate(gate);
      expect(await redirectOf(page), `${gate}`).toBe(GATE_PAGES[gate]);
    }
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
      expect(audits.unauthenticated.at(-1)).toEqual(["staff.request", route]);
      for (const gate of ["choose_password", "enrol_authenticator", "hub"] as const) {
        if (spec.access === gate || spec.access === "any_gate") continue;
        session.current = atGate(gate);
        const refused = await handler(jsonRequest(route, method));
        expect(refused.status, gate).toBe(403);
        expect(await refused.json()).toEqual({ error: "setup_incomplete" });
        expect(audits.outsideGate.at(-1)).toEqual([atGate(gate).staffId, route]);
      }
    }
  });
});

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
    }
  });

  it("refuse without a session and at another gate, before their own code", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const exportsOf: Record<string, (...args: unknown[]) => Promise<{ status: string; message?: string }>> = await import(file);
    for (const [name, action] of Object.entries(exportsOf)) {
      const spec = guardSpecOf(action);
      if (!spec || spec.access === "public") continue;
      session.current = null;
      expect(await action({ status: "idle" }, new FormData()), name).toMatchObject({ status: "refused", message: "Sign in to continue." });
      for (const gate of ["choose_password", "enrol_authenticator", "hub"] as const) {
        if (spec.access === gate || spec.access === "any_gate") continue;
        session.current = atGate(gate);
        expect(await action({ status: "idle" }, new FormData()), `${name} at ${gate}`).toMatchObject({
          status: "refused",
          message: "Finish setting up your account first.",
        });
      }
    }
  });
});

describe("the setup sequence's gate 1", () => {
  it("leaves only Choose your password, POST /api/staff/password, GET /api/staff/me and sign-out reachable", async () => {
    const { guardSpecOf } = await import("../src/app/staff/guard");
    const reachable: string[] = [];
    for (const file of pages) {
      const spec = guardSpecOf((await import(file)).default);
      if (spec && spec.access !== "public" && (spec.access === "choose_password" || spec.access === "any_gate")) reachable.push(`page ${spec.route}`);
    }
    for (const file of handlers) {
      const exportsOf: Record<string, unknown> = await import(file);
      for (const method of HTTP_METHODS.filter((name) => name in exportsOf)) {
        const spec = guardSpecOf(exportsOf[method]);
        if (spec && (spec.access === "choose_password" || spec.access === "any_gate" || spec.access === "public")) reachable.push(`${method} ${spec.route}`);
      }
    }
    expect(reachable.sort()).toEqual(["GET /api/staff/me", "POST /api/staff/password", "POST /api/staff/sign-in", "POST /api/staff/sign-out", "page /staff/setup/password"]);
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
