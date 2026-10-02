import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/contracts/staffRoles";
import { HUB_BRAND, hubNavigation, hubShellLabels, hubShellUser } from "./hubShell";
import type { StaffSession } from "./session";

const session = (overrides: Partial<StaffSession> = {}): StaffSession => ({
  staffId: "01900000-0000-7000-8000-000000000001",
  username: "aokafor",
  firstName: "Ann",
  lastName: "Okafor",
  role: "ambassador",
  gate: "hub",
  ...overrides,
});

describe("hubShellUser", () => {
  it("is the name and role of someone at the Hub gate", () => {
    expect(hubShellUser(session())).toEqual({ displayName: "Ann Okafor", role: "ambassador" });
    expect(hubShellUser(session({ role: "admin" }))).toEqual({ displayName: "Ann Okafor", role: "admin" });
  });

  it("is nobody when nobody is signed in, and nobody at a setup gate (those pages are not in the shell)", () => {
    expect(hubShellUser(null)).toBeNull();
    expect(hubShellUser(session({ gate: "choose_password" }))).toBeNull();
    expect(hubShellUser(session({ gate: "enrol_authenticator" }))).toBeNull();
  });
});

describe("hubNavigation", () => {
  const items = (role: (typeof STAFF_ROLES)[number]) => hubNavigation(role).flatMap((section) => section.items);

  it("lists the pilot's four disruption screens in the prototype's order, with the home first", () => {
    expect(items("coordinator").map((item) => item.label)).toEqual(["Incidents", "Compose an alert", "Moderation", "Check-in rounds"]);
    expect(items("coordinator")[0]).toMatchObject({ href: "/staff", exact: true });
  });

  it("adds Administration with People for Admins only", () => {
    for (const role of STAFF_ROLES) {
      expect(items(role).some((item) => item.href === "/staff/people"), role).toBe(role === "admin");
    }
  });

  it("links an item only to a page that exists; the others are text until their story builds the page", () => {
    const app = path.join(__dirname, "..");
    for (const item of items("admin")) {
      if (item.href === null) continue;
      expect(existsSync(path.join(app, item.href, "page.tsx")), `${item.label}: ${item.href}`).toBe(true);
    }
    expect(items("admin").filter((item) => item.href === null).map((item) => item.id)).toEqual(["compose", "moderation", "rounds"]);
  });

  it("uses each id once and the English catalog's labels", () => {
    const all = items("admin");

    expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
    expect(hubNavigation("admin").map((section) => section.label)).toEqual(["In a disruption", "Administration"]);
  });
});

describe("hubShellLabels", () => {
  it("has the catalog's words, a role name for every role, and the sentence left as a template for the shell to fill", () => {
    const labels = hubShellLabels();

    expect(labels.appName).toBe("Hub and partner space");
    expect(labels.menu).toBe("Menu");
    expect(labels.signedInAs).toBe("Signed in as {name}, {role}");
    expect(Object.keys(labels.roles).sort()).toEqual([...STAFF_ROLES].sort());
    expect(labels.roles.coordinator).toBe("Coordinator");
  });

  it("points at brand files that are in public/", () => {
    for (const src of Object.values(HUB_BRAND)) expect(existsSync(path.join(__dirname, "..", "..", "..", "public", src)), src).toBe(true);
  });
});
