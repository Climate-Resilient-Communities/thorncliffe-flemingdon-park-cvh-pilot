// The approval view of an update to a running alert (S05.01): the approver is told it is an update, and what it changes about who the alert is for, in
// the words "Now also for: ..." (and "No longer for: ..." for a narrowing), right under who it is for, above the fold on a phone.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Audience } from "@/contracts/audience";
import { APPROVER, PLANS, floorId, reviewOf } from "../../../../../test/helpers/approvalReview";
import { ApprovalBody, type ApprovalActions } from "./ApprovalBody";
import { approvalScreen, type ApprovalScreen } from "./view";

const noop = async () => ({ status: "idle" as const });
const actions: ApprovalActions = { approve: noop, returnToAuthor: noop, discard: noop };

const FLOORS_3_4 = [floorId("4154146", 3), floorId("4154146", 4)];
const buildings = (list: { rsn: string; floors: string[] | null }[], groups: string[] = []): Audience => ({ scope: "buildings", buildings: list, groups: groups as Audience["groups"], types: ["elevator", "power"] });
/** What the thread has now: the acknowledgement's audience, the one `reviewOf` gives an entry. */
const NOW_AUDIENCE = buildings([{ rsn: "4154146", floors: FLOORS_3_4 }, { rsn: "4154159", floors: null }], ["seniors"]);

const screenOf = (audience: Audience, threadAudience: Audience | null = NOW_AUDIENCE, entry: Record<string, unknown> = { kind: "update" }): ApprovalScreen => {
  const review = reviewOf({ threadAudience, entry: entry as never });
  review.entry = { ...review.entry, content: { ...review.entry.content, audience } };
  return approvalScreen({ review, plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER });
};
const html = (screen: ApprovalScreen) => renderToStaticMarkup(<ApprovalBody screen={screen} actions={actions} />);

describe("an update that widens the audience", () => {
  it('says "Now also for: ..." with the buildings and floors it newly reaches, and nothing is dropped', () => {
    const screen = screenOf(
      buildings([{ rsn: "4154146", floors: [...FLOORS_3_4, floorId("4154146", 5)] }, { rsn: "4154159", floors: null }], ["families", "seniors"]),
    );
    expect(screen.facts.audience.change).toEqual({ alsoFor: "Now also for: 4 Milepost Pl (floors 5) and Families with young children", noLongerFor: null });
  });

  it("says it for a whole neighbourhood added to a neighbourhood", () => {
    const screen = screenOf(
      { scope: "neighbourhood", neighbourhood_ids: ["FP", "TP"], groups: [], types: ["elevator", "power"] },
      { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["elevator", "power"] },
    );
    expect(screen.facts.audience.change?.alsoFor).toMatch(/^Now also for: /);
    expect(screen.facts.audience.change?.noLongerFor).toBeNull();
  });

  it("says it for a widening from some groups to everyone: the people outside the groups are now reached", () => {
    const screen = screenOf(buildings([{ rsn: "4154146", floors: FLOORS_3_4 }, { rsn: "4154159", floors: null }], []));
    expect(screen.facts.audience.change).toEqual({ alsoFor: "Now also for: residents who chose none of the groups", noLongerFor: null });
  });
});

describe("what the approval is bound to", () => {
  it("names the entry that covers the thread, in the screen's binding and in every form, so a change of it is caught at the press", () => {
    const screen = screenOf(NOW_AUDIENCE);
    expect(screen.binding.covering).toBe("01900000-0000-7000-8000-00000000c0e1");
    expect(html(screen)).toContain('name="covering" value="01900000-0000-7000-8000-00000000c0e1"');
  });

  it("names none for an entry that follows no other", () => {
    const review = reviewOf();
    const screen = approvalScreen({ review, plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER });
    expect(screen.binding.covering).toBeUndefined();
    expect(html(screen)).not.toContain('name="covering"');
  });
});

describe("an update that narrows the audience", () => {
  it('says "No longer for: ..." the same way, with what it stops reaching', () => {
    const screen = screenOf(buildings([{ rsn: "4154146", floors: [FLOORS_3_4[0]] }], ["seniors"]));
    expect(screen.facts.audience.change).toEqual({
      alsoFor: null,
      noLongerFor: "No longer for: 4 Milepost Pl (floors 4) and 85-95 Thorncliffe Park Dr (all floors)",
    });
  });

  it("says both lines when it swaps one place for another", () => {
    const screen = screenOf(buildings([{ rsn: "4154146", floors: FLOORS_3_4 }, { rsn: "9999999", floors: null }], ["seniors"]));
    expect(screen.facts.audience.change?.alsoFor).toBe("Now also for: a building that is not in the list");
    expect(screen.facts.audience.change?.noLongerFor).toBe("No longer for: 85-95 Thorncliffe Park Dr (all floors)");
  });

  it("says the rest of a neighbourhood is dropped when an update narrows it to buildings in it", () => {
    const screen = screenOf(buildings([{ rsn: "4154146", floors: null }]), { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["elevator", "power"] });
    expect(screen.facts.audience.change).toEqual({ alsoFor: null, noLongerFor: "No longer for: the rest of Thorncliffe Park" });
  });
});

describe("an update that keeps the audience, and entries that are not updates", () => {
  it("says nothing about a change, but still says it is an update to an alert residents are already reading", () => {
    const screen = screenOf(NOW_AUDIENCE);
    expect(screen.facts.audience.change).toBeUndefined();
    expect(screen.header.update).toBe("This is an update to an alert residents are already reading. It is added above the earlier entries, which stay as they are.");
  });

  it("says nothing of either for a thread's first entry, an acknowledgement or a full alert written first", () => {
    for (const kind of ["ack", "update"]) {
      const screen = screenOf(NOW_AUDIENCE, null, { kind });
      expect(screen.facts.audience.change).toBeUndefined();
      expect(screen.header.update).toBeNull();
    }
  });

  it("does not call an acknowledgement an update even when the thread has an audience to compare with", () => {
    expect(screenOf(NOW_AUDIENCE, NOW_AUDIENCE, { kind: "ack" }).header.update).toBeNull();
  });
});

describe("the approval view as it is drawn", () => {
  const changed = html(screenOf(buildings([{ rsn: "4154146", floors: [FLOORS_3_4[0]] }, { rsn: "4154159", floors: null }, { rsn: "9999999", floors: null }], ["seniors"])));

  it("puts the change right under who it is for, in flagged notes with the two lines apart, above the channels and the aside", () => {
    expect(changed).toContain('data-testid="update-note"');
    expect(changed).toMatch(/<p role="note" class="hub-flag hub-wrap" data-testid="audience-also-for">Now also for: a building that is not in the list<\/p>/);
    expect(changed).toMatch(/<p role="note" class="hub-flag hub-wrap" data-testid="audience-no-longer-for">No longer for: 4 Milepost Pl \(floors 4\)<\/p>/);
    const at = (id: string) => changed.indexOf(`data-testid="${id}"`);
    expect(at("fact-audience")).toBeLessThan(at("audience-also-for"));
    expect(at("audience-also-for")).toBeLessThan(at("audience-no-longer-for"));
    expect(at("audience-no-longer-for")).toBeLessThan(at("fact-channels"));
    expect(at("audience-no-longer-for")).toBeLessThan(at("approval-aside"));
  });

  it("draws neither line for an update that keeps the audience, and no note for an entry that is not an update", () => {
    const same = html(screenOf(NOW_AUDIENCE));
    expect(same).toContain('data-testid="update-note"');
    expect(same).not.toContain('data-testid="audience-change"');
    expect(html(screenOf(NOW_AUDIENCE, null, { kind: "ack" }))).not.toContain('data-testid="update-note"');
  });
});
