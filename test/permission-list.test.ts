// The permission test list is complete (S01.12): every staff page, route handler and server
// action found on disk (test/helpers/staffSurface.ts, the enumeration of test/staff-guard.test.ts)
// has its row in test/permissions/endpoints.ts, with the route and policy action its guard
// declares, and the list names nothing that is gone. A story that adds a staff endpoint fails here
// until it adds the row, and with it the calls of test/db/permissions.db.test.ts.
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { STAFF_ROLES } from "../src/contracts/staffRoles";
import { can, isPolicyAction } from "../src/modules/identity";
import { findStaffSurface, routePathOf } from "./helpers/staffSurface";
import { PUBLIC_ENDPOINTS, ROLE_CALLERS, STAFF_ENDPOINTS } from "./permissions/endpoints";

// The route files are imported to read their guards; nothing of them runs.
vi.mock("../src/app/staff/session", () => ({ currentStaffSession: async () => null }));
vi.mock("../src/app/staff/identity", () => ({ identity: () => ({}), staffAuth: () => ({}), identityConfigured: () => false, requestAuthSessions: async () => ({}) }));

const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "src", "app");
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

interface Found {
  id: string;
  file: string;
  export: string;
  route?: string;
  action?: string;
  access?: unknown;
}

/** Every staff endpoint on disk, with what its guard declares. */
async function staffEndpointsOnDisk(): Promise<Found[]> {
  const { guardSpecOf } = await import("../src/app/staff/guard");
  const surface = findStaffSurface(APP, path.join(ROOT, "src"));
  const found: Found[] = [];
  for (const file of surface.pages) {
    const spec = guardSpecOf((await import(file)).default);
    found.push({ id: `page ${routePathOf(APP, file)}`, file: relative(file), export: "default", ...spec });
  }
  for (const file of surface.handlers) {
    const exportsOf: Record<string, unknown> = await import(file);
    for (const method of HTTP_METHODS.filter((name) => name in exportsOf)) {
      found.push({ id: `${method} ${routePathOf(APP, file)}`, file: relative(file), export: method, ...guardSpecOf(exportsOf[method]) });
    }
  }
  for (const file of surface.actionFiles) {
    const exportsOf: Record<string, unknown> = await import(file);
    for (const [name, value] of Object.entries(exportsOf)) {
      found.push({ id: `action ${relative(file)}#${name}`, file: relative(file), export: name, ...guardSpecOf(value) });
    }
  }
  return found;
}

describe("the permission test list", () => {
  it("has a row for every staff page, route handler and server action on disk, and none for anything else", async () => {
    const onDisk = (await staffEndpointsOnDisk()).map((endpoint) => endpoint.id).sort();
    const listed = [...STAFF_ENDPOINTS, ...PUBLIC_ENDPOINTS].map((endpoint) => endpoint.id).sort();
    const missing = onDisk.filter((id) => !listed.includes(id));
    const gone = listed.filter((id) => !onDisk.includes(id));
    expect(missing, "staff endpoints missing from test/permissions/endpoints.ts").toEqual([]);
    expect(gone, "rows of test/permissions/endpoints.ts with no endpoint").toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("lists each endpoint with the file, route and policy action its guard declares, and the public ones as public", async () => {
    const onDisk = new Map((await staffEndpointsOnDisk()).map((endpoint) => [endpoint.id, endpoint]));
    for (const row of STAFF_ENDPOINTS) {
      const found = onDisk.get(row.id);
      expect(found, row.id).toMatchObject({ file: row.file, export: row.export, route: row.route, action: row.action });
      expect(found?.access, row.id).not.toBe("public");
    }
    for (const row of PUBLIC_ENDPOINTS) {
      expect(onDisk.get(row.id), row.id).toMatchObject({ file: row.file, export: row.export, route: row.route, access: "public" });
    }
  });

  it("expects what the policy decides for each role, and a Director refused every business write", () => {
    for (const row of STAFF_ENDPOINTS) {
      expect(isPolicyAction(row.action), row.id).toBe(true);
      expect(Object.keys(row.expected).sort(), row.id).toEqual([...ROLE_CALLERS].sort());
      for (const role of STAFF_ROLES) {
        // Out of the gate's reach is the setup sequence's refusal; otherwise the row agrees with can().
        if (row.expected[role] === "setup_incomplete") continue;
        expect(row.expected[role] === "allowed", `${row.id} as ${role}`).toBe(can(role, row.action));
      }
      if (row.writes === "business") expect(row.expected.director, `${row.id}: a Director may not write business data`).toBe("forbidden");
      if (row.kind === "action") expect(row.writes, `${row.id}: a server action acts`).not.toBe("none");
      if (row.kind === "page") expect(row.writes, `${row.id}: a page shows`).toBe("none");
    }
  });

  it("calls every route handler and server action that writes with a real request", () => {
    for (const row of STAFF_ENDPOINTS) {
      if (row.kind === "route" && row.writes !== "none") expect(row.body, row.id).toBeDefined();
      if (row.kind === "action") expect(row.form, row.id).toBeDefined();
    }
  });
});
