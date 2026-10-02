import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/contracts/staffRoles";
import { can } from "@/modules/identity";
import { HUB_NAV_ICONS } from "@/ui/hub";
import { HUB_BRAND, hubNavigation, hubShellLabels, hubShellUser, hubTabTitle } from "./hubShell";
import type { StaffSession } from "./session";

const session = (overrides: Partial<StaffSession> = {}): StaffSession => ({
  staffId: "01900000-0000-7000-8000-000000000001",
  sessionId: "01900000-0000-7000-8000-0000000000aa",
  username: "aokafor",
  firstName: "Ann",
  lastName: "Okafor",
  role: "ambassador",
  gate: "hub",
  aal: "aal1",
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

  it("lists the pilot's three disruption screens in the prototype's order, with the home first, then Coverage for the roles that see it, and People, Providers, Directory and Buildings for Admins", () => {
    expect(items("ambassador").map((item) => item.label)).toEqual(["Incidents", "Compose an alert", "Check-in rounds"]);
    expect(items("coordinator").map((item) => item.label)).toEqual(["Incidents", "Compose an alert", "Check-in rounds", "Coverage"]);
    expect(items("director").map((item) => item.label)).toEqual(["Incidents", "Compose an alert", "Check-in rounds", "Coverage"]);
    expect(items("coordinator")[0]).toMatchObject({ href: "/staff", exact: true });
    expect(items("admin").map((item) => item.label)).toEqual(["Incidents", "Compose an alert", "Check-in rounds", "Coverage", "People", "Providers", "Directory", "Buildings", "Test text"]);
  });

  it("adds Coverage for exactly the roles whose policy allows coverage.view, with an icon no other item uses", () => {
    for (const role of STAFF_ROLES) {
      expect(items(role).some((item) => item.href === "/staff/coverage"), role).toBe(can(role, "coverage.view"));
    }
    const coverage = items("admin").find((item) => item.id === "coverage");
    expect(coverage).toEqual({ id: "coverage", label: "Coverage", href: "/staff/coverage", icon: "ready" });
    expect(items("admin").filter((item) => item.icon === coverage?.icon)).toHaveLength(1);
  });

  it("has no MVP destination: no Moderation, partner space or readiness item or section", () => {
    const everything = JSON.stringify(STAFF_ROLES.map((role) => hubNavigation(role)));

    for (const mvp of ["Moderation", "moderation", "Partner space", "This disruption", "Between disruptions", "Readiness", "Playbooks"]) {
      expect(everything, mvp).not.toContain(mvp);
    }
    for (const role of STAFF_ROLES) expect(hubNavigation(role).map((section) => section.id), role).toEqual(role === "admin" ? ["disruption", "admin"] : ["disruption"]);
  });

  it("adds Administration with People, Providers, Directory, Buildings and Test text for Admins only", () => {
    for (const role of STAFF_ROLES) {
      expect(items(role).some((item) => item.href === "/staff/people"), role).toBe(role === "admin");
      expect(items(role).some((item) => item.href === "/staff/providers"), role).toBe(role === "admin");
      expect(items(role).some((item) => item.href === "/staff/directory"), role).toBe(role === "admin");
      expect(items(role).some((item) => item.href === "/staff/buildings"), role).toBe(role === "admin");
    }
    const administration = hubNavigation("admin").find((section) => section.id === "admin");
    expect(administration?.items).toEqual([
      { id: "people", label: "People", href: "/staff/people", icon: "person" },
      { id: "providers", label: "Providers", href: "/staff/providers", icon: "inbox" },
      { id: "directory", label: "Directory", href: "/staff/directory", icon: "layers" },
      { id: "buildings", label: "Buildings", href: "/staff/buildings", icon: "building" },
      { id: "sms-test", label: "Test text", href: "/staff/sms-test", icon: "phone" },
    ]);
  });

  it("adds the first-text spike's Test text for Admins only", () => {
    for (const role of STAFF_ROLES) {
      expect(items(role).some((item) => item.href === "/staff/sms-test"), role).toBe(role === "admin");
    }
  });

  it("gives Test text a phone icon of its own: not the inbox another item uses, and one the shell's stylesheet draws", () => {
    const smsTest = items("admin").find((item) => item.href === "/staff/sms-test");
    expect(smsTest?.icon).toBe("phone");
    expect(smsTest?.icon).not.toBe("inbox");
    expect(HUB_NAV_ICONS).toContain("phone");
    const stylesheet = readFileSync(path.join(__dirname, "..", "..", "ui", "hub", "hub-icons.css"), "utf8");
    for (const icon of HUB_NAV_ICONS) expect(stylesheet, icon).toContain(`.hub-ico--${icon} {`);
  });

  it("gives Directory a layers icon of its own: not the inbox Providers uses, and one the shell's stylesheet draws", () => {
    const directory = items("admin").find((item) => item.href === "/staff/directory");
    const providers = items("admin").find((item) => item.href === "/staff/providers");
    expect(directory?.icon).toBe("layers");
    expect(directory?.icon).not.toBe(providers?.icon);
    expect(HUB_NAV_ICONS).toContain("layers");
    const stylesheet = readFileSync(path.join(__dirname, "..", "..", "ui", "hub", "hub-icons.css"), "utf8");
    expect(stylesheet).toContain(".hub-ico--layers {");
  });

  it("links an item only to a page that exists; the others are text until their story builds the page", () => {
    const app = path.join(__dirname, "..");
    for (const item of items("admin")) {
      if (item.href === null) continue;
      expect(existsSync(path.join(app, item.href, "page.tsx")), `${item.label}: ${item.href}`).toBe(true);
    }
    expect(items("admin").filter((item) => item.href === null).map((item) => item.id)).toEqual(["compose", "rounds"]);
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

    // The pilot's name for the Hub, not the MVP's "Hub and partner space".
    expect(labels.appName).toBe("Hub");
    expect(JSON.stringify(labels)).not.toContain("partner");
    expect(labels.menu).toBe("Menu");
    expect(labels.signedInAs).toBe("Signed in as {name}, {role}");
    expect(Object.keys(labels.roles).sort()).toEqual([...STAFF_ROLES].sort());
    expect(labels.roles.coordinator).toBe("Coordinator");
  });

  it("names the tab Hub, then the Hub's full name, never the MVP's Hub and partner space", () => {
    expect(hubTabTitle()).toBe("Hub · Thorncliffe Park Community Hub");
  });

  it("points at brand files that are in public/", () => {
    for (const src of Object.values(HUB_BRAND)) expect(existsSync(path.join(__dirname, "..", "..", "..", "public", src)), src).toBe(true);
  });
});
