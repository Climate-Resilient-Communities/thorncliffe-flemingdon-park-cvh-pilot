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

  it("lists the pilot's disruption screens in the prototype's order, with the home first, the alert screens for the roles that write alerts, then Coverage for the roles that see it, and People, Providers, Directory and Buildings for Admins", () => {
    expect(items("ambassador").map((item) => item.label)).toEqual(["My building", "Check-in rounds", "Text sign-up"]);
    expect(items("coordinator")[0]).toMatchObject({ href: "/staff", exact: true });
    expect(items("director").map((item) => item.label)).toEqual(["Incidents", "Check-in rounds", "Coverage", "Spend", "Measures"]);
    expect(items("coordinator").map((item) => item.label)).toEqual(["Incidents", "Log a disruption", "Compose an alert", "Check-in rounds", "Coverage", "Measures", "Text sign-up"]);
    expect(items("admin").map((item) => item.label)).toEqual(["Incidents", "Log a disruption", "Compose an alert", "Check-in rounds", "Coverage", "Spend", "Measures", "Text sign-up", "People", "Providers", "Directory", "Buildings", "Pause texts", "On-call numbers", "Drills", "End of pilot"]);
  });

  it("links Log a disruption and Compose an alert (S04.05) to their pages for exactly the roles whose policy allows alert.author_wide", () => {
    for (const role of STAFF_ROLES) {
      expect(items(role).some((item) => item.href === "/staff/alerts/log"), role).toBe(can(role, "alert.author_wide"));
      expect(items(role).some((item) => item.href === "/staff/alerts/compose"), role).toBe(can(role, "alert.author_wide"));
    }
    expect(items("admin").find((item) => item.id === "log")).toEqual({ id: "log", label: "Log a disruption", href: "/staff/alerts/log", icon: "flag" });
    expect(items("admin").find((item) => item.id === "compose")).toEqual({ id: "compose", label: "Compose an alert", href: "/staff/alerts/compose", icon: "pencil" });
    expect(items("admin").filter((item) => item.icon === "flag")).toHaveLength(1);
  });

  it("adds Coverage for exactly the roles whose policy allows coverage.view, with an icon no other item uses", () => {
    for (const role of STAFF_ROLES) {
      expect(items(role).some((item) => item.href === "/staff/coverage"), role).toBe(can(role, "coverage.view"));
    }
    const coverage = items("admin").find((item) => item.id === "coverage");
    expect(coverage).toEqual({ id: "coverage", label: "Coverage", href: "/staff/coverage", icon: "ready" });
    expect(items("admin").filter((item) => item.icon === coverage?.icon)).toHaveLength(1);
  });

  it("adds Measures (S07.10) for exactly the roles whose policy allows coverage.view", () => {
    for (const role of STAFF_ROLES) {
      expect(items(role).some((item) => item.href === "/staff/measures"), role).toBe(can(role, "coverage.view"));
    }
    expect(items("director").find((item) => item.id === "measures")).toEqual({ id: "measures", label: "Measures", href: "/staff/measures", icon: "layers" });
  });

  it("adds Text sign-up (S07.03) for exactly the roles whose policy allows signup.assist: not a Director", () => {
    for (const role of STAFF_ROLES) {
      expect(items(role).some((item) => item.href === "/staff/text-signup"), role).toBe(can(role, "signup.assist"));
    }
    expect(items("director").some((item) => item.id === "text-signup")).toBe(false);
    expect(items("ambassador").find((item) => item.id === "text-signup")).toEqual({ id: "text-signup", label: "Text sign-up", href: "/staff/text-signup", icon: "phone" });
  });

  it("has no MVP destination: no Moderation, partner space or readiness item or section", () => {
    const everything = JSON.stringify(STAFF_ROLES.map((role) => hubNavigation(role)));

    for (const mvp of ["Moderation", "moderation", "Partner space", "This disruption", "Between disruptions", "Readiness", "Playbooks"]) {
      expect(everything, mvp).not.toContain(mvp);
    }
    for (const role of STAFF_ROLES) expect(hubNavigation(role).map((section) => section.id), role).toEqual(role === "admin" ? ["disruption", "admin"] : ["disruption"]);
  });

  it("shows Spend (S07.08) beside Coverage to the roles whose policy has spend.view: an Admin, and a Director read-only", () => {
    for (const role of STAFF_ROLES) {
      expect(items(role).some((item) => item.href === "/staff/spend"), role).toBe(role === "admin" || role === "director");
    }
    expect(items("admin").find((item) => item.href === "/staff/spend")).toEqual({ id: "spend", label: "Spend", href: "/staff/spend", icon: "layers" });
  });

  it("adds Administration with People, Providers, Directory, Buildings, Pause texts, On-call numbers and Drills for Admins only", () => {
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
      { id: "texts", label: "Pause texts", href: "/staff/texts", icon: "pause" },
      { id: "oncall", label: "On-call numbers", href: "/staff/oncall", icon: "phone" },
      { id: "drills", label: "Drills", href: "/staff/drills", icon: "phone" },
      { id: "campaign", label: "End of pilot", href: "/staff/campaign", icon: "phone" },
    ]);
  });

  it("adds Pause texts for exactly the roles whose policy allows sending.pause, with a pause icon of its own that the shell's stylesheet draws", () => {
    for (const role of STAFF_ROLES) {
      expect(items(role).some((item) => item.href === "/staff/texts"), role).toBe(can(role, "sending.pause"));
      expect(items(role).some((item) => item.href === "/staff/texts"), role).toBe(role === "admin");
    }
    const texts = items("admin").find((item) => item.href === "/staff/texts");
    expect(texts?.icon).toBe("pause");
    expect(items("admin").filter((item) => item.icon === "pause")).toHaveLength(1);
    expect(HUB_NAV_ICONS).toContain("pause");
    const stylesheet = readFileSync(path.join(__dirname, "..", "..", "ui", "hub", "hub-icons.css"), "utf8");
    expect(stylesheet).toContain(".hub-ico--pause {");
  });

  it("adds Drills (S06.05) for exactly the roles whose policy allows drill.run (Admins)", () => {
    for (const role of STAFF_ROLES) {
      expect(items(role).some((item) => item.href === "/staff/drills"), role).toBe(can(role, "drill.run"));
      expect(items(role).some((item) => item.href === "/staff/drills"), role).toBe(role === "admin");
    }
  });

  it("adds On-call numbers for exactly the roles whose policy allows oncall.manage (Admins)", () => {
    for (const role of STAFF_ROLES) {
      expect(items(role).some((item) => item.href === "/staff/oncall"), role).toBe(can(role, "oncall.manage"));
      expect(items(role).some((item) => item.href === "/staff/oncall"), role).toBe(role === "admin");
    }
  });

  it("draws every navigation icon in the shell stylesheet, and no longer offers the removed spike page", () => {
    for (const role of STAFF_ROLES) expect(items(role).some((item) => item.href === "/staff/sms-test"), role).toBe(false);
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
    // S08.08 built "Check-in rounds" (O-17) for the Hub's roles; an Ambassador's round is their own page, reached from their home.
    expect(items("admin").filter((item) => item.href === null).map((item) => item.id)).toEqual([]);
    for (const role of ["coordinator", "director", "admin"] as const) expect(items(role).find((item) => item.id === "rounds")?.href).toBe("/staff/rounds");
    expect(items("ambassador").find((item) => item.id === "rounds")?.href).toBeNull();
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
