import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHARED_CACHE_GUIDES } from "../../app/guideCache";
import { MAPPED_GUIDES, guideDuringHref, guidesFor } from "./guides";

describe("the guides an alert links to", () => {
  it("is one guide for each type that has one, in the order of the types", () => {
    expect(guidesFor(["power"])).toEqual(["power"]);
    expect(guidesFor(["elevator", "power"])).toEqual(["elevator", "power"]);
    expect(guidesFor(["heat", "smoke", "fire", "flood"])).toEqual(["heat", "smoke", "fire", "flood"]);
  });

  it("reads water or plumbing as the flood and plumbing guide, and a winter storm as the power one (the prototype's own mapping)", () => {
    expect(guidesFor(["water"])).toEqual(["flood"]);
    expect(guidesFor(["winter"])).toEqual(["power"]);
  });

  it("names a guide once when two types share it", () => {
    expect(guidesFor(["flood", "water"])).toEqual(["flood"]);
    expect(guidesFor(["winter", "power", "elevator"])).toEqual(["power", "elevator"]);
  });

  it("has no guide for Other, or for a type it does not know", () => {
    expect(guidesFor(["other"])).toEqual([]);
    expect(guidesFor(["other", "elevator"])).toEqual(["elevator"]);
    expect(guidesFor(["no-such-type"])).toEqual([]);
    expect(guidesFor([])).toEqual([]);
  });

  it("opens a guide at During", () => {
    expect(guideDuringHref("en", "power")).toBe("/en/ready/power#during");
    expect(guideDuringHref("ur", "flood")).toBe("/ur/ready/flood#during");
  });

  it("only ever names a guide the pilot launches with, so a link never opens a 404", () => {
    for (const guide of MAPPED_GUIDES) expect(SHARED_CACHE_GUIDES as readonly string[], guide).toContain(guide);
  });

  it("names a guide whose id is the name of its icon in the shell's set (the detail page draws that icon)", () => {
    const icons = readFileSync(path.join(__dirname, "..", "shell", "icons.css"), "utf8");
    for (const guide of MAPPED_GUIDES) expect(icons, guide).toContain(`.shell-ico--${guide} {`);
  });
});
