import { describe, expect, it } from "vitest";
import { isCurrent } from "./resident-nav";

describe("isCurrent", () => {
  const home = { href: "/en" };
  const help = { href: "/en/search", alsoCurrentOn: ["/en/directory"] };
  const ready = { href: "/en/ready" };

  it("marks an item on its own path and on pages below it", () => {
    expect(isCurrent("/en/ready", ready, false)).toBe(true);
    expect(isCurrent("/en/ready/", ready, false)).toBe(true);
    expect(isCurrent("/en/ready/numbers", ready, false)).toBe(true);
    expect(isCurrent("/en/readyx", ready, false)).toBe(false);
  });

  it("marks home only on the home page, not on every page below it", () => {
    expect(isCurrent("/en", home, true)).toBe(true);
    expect(isCurrent("/en/directory", home, true)).toBe(false);
  });

  it("marks an item on the extra paths it was given, and the pages below them, as well as on its own path", () => {
    expect(isCurrent("/en/search", help, false)).toBe(true);
    expect(isCurrent("/en/directory", help, false)).toBe(true);
    expect(isCurrent("/en/directory/P101", help, false)).toBe(true);
    expect(isCurrent("/en/directories", help, false)).toBe(false);
    expect(isCurrent("/en/ready", help, false)).toBe(false);
  });

  it("marks home on the alerts' pages when it is given them, and still on no other page below it (R-07 is on Alerts)", () => {
    const now = { href: "/en", alsoCurrentOn: ["/en/alerts"] };

    expect(isCurrent("/en", now, true)).toBe(true);
    expect(isCurrent("/en/alerts/kbcdfghj", now, true)).toBe(true);
    expect(isCurrent("/en/alerts/kbcdfghj/verified", now, true)).toBe(true);
    expect(isCurrent("/en/alertsx", now, true)).toBe(false);
    expect(isCurrent("/en/ready", now, true)).toBe(false);
    expect(isCurrent("/en/directory", now, true)).toBe(false);
  });

  it("does not mark an item that was given no extra path on the directory", () => {
    expect(isCurrent("/en/directory", ready, false)).toBe(false);
  });
});
