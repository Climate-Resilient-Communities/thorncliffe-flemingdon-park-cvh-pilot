import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Audience } from "@/contracts/audience";
import type { BuildingFloorPlan } from "@/modules/places";
import { composerFrom, savedLocation } from "./editAudience";
import { AudienceBody, type AudienceActions } from "./AudienceBody";
import { groupsScreen, lockedScreen, placeScreen } from "./view";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const REF = { alertId: ALERT, entryId: ENTRY };
const noop = async () => ({ status: "idle" as const });
const actions: AudienceActions = { place: noop, groups: noop };
const PLANS: BuildingFloorPlan[] = [{ rsn: "7001", address: "45 Thorncliffe Park Dr", neighbourhoodId: "TP", neighbourhoodName: "Thorncliffe Park", floors: [] }];
const AUDIENCE: Audience = { scope: "buildings", buildings: [{ rsn: "7001", floors: null }], groups: [], types: ["power"] };

const html = (screen: Parameters<typeof AudienceBody>[0]["screen"]) => renderToStaticMarkup(<AudienceBody screen={screen} actions={actions} />);
const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};

describe("the audience pages opened from a composer (S04.05)", () => {
  it("show the way back to the composer they came from, and send it on in a hidden field", () => {
    for (const [from, page] of [["ack", "/staff/alerts/ack"], ["compose", "/staff/alerts/compose"]] as const) {
      for (const screen of [placeScreen(PLANS, AUDIENCE, REF, { from }), groupsScreen(PLANS, AUDIENCE, REF, { from })]) {
        const out = html(screen);
        expect(out, `${screen.kind} from ${from}`).toContain(`data-testid="audience-back"`);
        expect(out).toContain(`href="${page}?alert=${ALERT}&amp;entry=${ENTRY}"`);
        expect(out).toContain("Back to the alert");
        expect(out).toContain(`<input type="hidden" name="from" value="${from}"/>`);
      }
    }
  });

  it("keep the way back when going between the place and the group page", () => {
    const place = html(placeScreen(PLANS, AUDIENCE, REF, { from: "ack" }));
    expect(place).toContain(`/staff/alerts/audience/groups?alert=${ALERT}&amp;entry=${ENTRY}&amp;from=ack`);
    const groups = html(groupsScreen(PLANS, AUDIENCE, REF, { from: "compose" }));
    expect(groups).toContain(`/staff/alerts/audience?alert=${ALERT}&amp;entry=${ENTRY}&amp;from=compose`);
  });

  it("show nothing extra when they were not opened from a composer: the pages are as they were", () => {
    for (const screen of [placeScreen(PLANS, AUDIENCE, REF), groupsScreen(PLANS, AUDIENCE, REF), placeScreen(PLANS, AUDIENCE, REF, { from: null })]) {
      const out = html(screen);
      expect(out).not.toContain("audience-back");
      expect(out).not.toContain('name="from"');
      expect(out).not.toContain("from=");
    }
  });

  it("show the way back on the page that says the entry cannot be changed, only when they came from a composer", () => {
    expect(html(lockedScreen(PLANS, AUDIENCE, undefined, "ack", REF))).toContain('data-testid="audience-back"');
    expect(html(lockedScreen(PLANS, AUDIENCE))).not.toContain("audience-back");
    expect(html(lockedScreen(PLANS, AUDIENCE, undefined, null, REF))).not.toContain("audience-back");
  });
});

describe("saving the place or the groups from a composer", () => {
  it("reads the composer from the hidden field, and only one of the two", () => {
    expect(composerFrom(form([["from", "ack"]]))).toBe("ack");
    expect(composerFrom(form([["from", "compose"]]))).toBe("compose");
    expect(composerFrom(form([["from", "https://example.test/"]]))).toBeNull();
    expect(composerFrom(form([["from", "/staff/alerts/ack"]]))).toBeNull();
    expect(composerFrom(form([]))).toBeNull();
  });

  it("goes on to the group page carrying the way back, and as before when there is none", () => {
    expect(savedLocation("place", REF, "ack")).toBe(`/staff/alerts/audience/groups?alert=${ALERT}&entry=${ENTRY}&done=place&from=ack`);
    expect(savedLocation("place", REF)).toBe(`/staff/alerts/audience/groups?alert=${ALERT}&entry=${ENTRY}&done=place`);
  });
});
