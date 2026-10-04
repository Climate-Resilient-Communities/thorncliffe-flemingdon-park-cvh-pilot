import { describe, expect, it } from "vitest";
import type { Audience } from "../../../contracts/audience";
import type { FeedThread } from "../../../contracts/feed";
import { AMBASSADOR_POST_STATES, audienceCoversAssigned, coveringFeedEntry, postIsInScope, postState, type PostFacts } from "./ambassadorHome";

const buildings = (...rsns: string[]): Audience => ({ scope: "buildings", buildings: rsns.map((rsn) => ({ rsn, floors: null })), groups: [], types: ["power"] });
const neighbourhoods = (...ids: string[]): Audience => ({ scope: "neighbourhood", neighbourhood_ids: ids, groups: [], types: ["heat"] });
const NEIGHBOURHOOD_OF = new Map([
  ["7001", "TP"],
  ["7002", "TP"],
  ["8001", "FP"],
]);

describe("which alerts are about an Ambassador's buildings", () => {
  it("covers a buildings audience that names an assigned building, whatever floors it lists, and no other", () => {
    expect(audienceCoversAssigned(buildings("7001"), new Set(["7001"]), NEIGHBOURHOOD_OF)).toBe(true);
    expect(audienceCoversAssigned(buildings("7002", "7001"), new Set(["7001"]), NEIGHBOURHOOD_OF)).toBe(true);
    expect(audienceCoversAssigned({ scope: "buildings", buildings: [{ rsn: "7001", floors: ["01900000-0000-7000-8000-000000000001"] }], groups: [], types: ["power"] }, new Set(["7001"]), NEIGHBOURHOOD_OF)).toBe(true);
    expect(audienceCoversAssigned(buildings("7002"), new Set(["7001"]), NEIGHBOURHOOD_OF)).toBe(false);
  });

  it("covers a neighbourhood audience when an assigned building is in one of its neighbourhoods", () => {
    expect(audienceCoversAssigned(neighbourhoods("TP"), new Set(["7001"]), NEIGHBOURHOOD_OF)).toBe(true);
    expect(audienceCoversAssigned(neighbourhoods("FP", "TP"), new Set(["7001"]), NEIGHBOURHOOD_OF)).toBe(true);
    expect(audienceCoversAssigned(neighbourhoods("FP"), new Set(["7001"]), NEIGHBOURHOOD_OF)).toBe(false);
  });

  it("covers nothing for a person with no assignment, and nothing in a neighbourhood the building is not known in", () => {
    expect(audienceCoversAssigned(buildings("7001"), new Set(), NEIGHBOURHOOD_OF)).toBe(false);
    expect(audienceCoversAssigned(neighbourhoods("TP"), new Set(), NEIGHBOURHOOD_OF)).toBe(false);
    expect(audienceCoversAssigned(neighbourhoods("TP"), new Set(["9999"]), NEIGHBOURHOOD_OF)).toBe(false);
  });
});

describe("whether an own post is still in scope", () => {
  it("is when it is for buildings and every one is still assigned; a removed assignment takes the post off", () => {
    expect(postIsInScope(buildings("7001"), new Set(["7001", "7002"]))).toBe(true);
    expect(postIsInScope(buildings("7001", "7002"), new Set(["7001", "7002"]))).toBe(true);
    expect(postIsInScope(buildings("7001", "7002"), new Set(["7001"]))).toBe(false);
    expect(postIsInScope(buildings("7001"), new Set())).toBe(false);
  });

  it("is never for a neighbourhood audience, which an Ambassador does not write", () => {
    expect(postIsInScope(neighbourhoods("TP"), new Set(["7001"]))).toBe(false);
  });
});

type FeedEntry = FeedThread["entries"][number];
const entry = (id: string, kind: FeedEntry["kind"], over: Partial<FeedEntry> = {}): FeedEntry => ({
  id,
  kind,
  verified: true,
  attribution: { role: "hub" },
  published_at: "2026-10-04T14:00:00.000Z",
  text: { lang: "en", body: id, machine: false, model: null, status: "source", source_hash: "0".repeat(64) },
  original: { lang: "en", body: id },
  ...over,
});

describe("the entry that covers an open thread", () => {
  it("is the latest substantive entry that nothing replaced", () => {
    expect(coveringFeedEntry([entry("a", "ack"), entry("b", "update")]).id).toBe("b");
    expect(coveringFeedEntry([entry("a", "ack"), entry("b", "update"), entry("c", "correction", { supersedes_id: "b" })]).id).toBe("c");
  });

  it("passes over an entry that a later one replaced, and over a withdrawal notice", () => {
    expect(coveringFeedEntry([entry("a", "ack"), entry("b", "update"), entry("c", "withdrawal", { supersedes_id: "b" })]).id).toBe("a");
  });

  it("agrees with the resident feed on which kinds can cover: only the substantive ones", () => {
    for (const kind of ["ack", "update", "correction", "final"] as const) expect(coveringFeedEntry([entry("a", "ack"), entry("b", kind)]).id).toBe("b");
    expect(coveringFeedEntry([entry("a", "ack"), entry("b", "withdrawal")]).id).toBe("a");
  });

  it("falls back to the latest entry when everything was replaced", () => {
    expect(coveringFeedEntry([entry("a", "ack"), entry("b", "withdrawal", { supersedes_id: "a" })]).id).toBe("b");
  });
});

describe("the state of an own post", () => {
  const T = (minutes: number) => new Date(Date.UTC(2026, 9, 4, 14, minutes, 0));
  const facts = (over: Partial<PostFacts>): PostFacts => ({ status: "pending_approval", submittedAt: T(0), approvedAt: null, webPublishedAt: null, returnedFor: null, replacedBy: null, ...over });

  it("is waiting while submitted and not yet read by residents, live while web-published at submit and not yet verified", () => {
    expect(postState(facts({}))).toBe("waiting");
    expect(postState(facts({ webPublishedAt: T(0) }))).toBe("live");
  });

  it("is approved when the approval published it, and verified when it was already live before the approval", () => {
    expect(postState(facts({ status: "approved", approvedAt: T(5), webPublishedAt: T(5) }))).toBe("approved");
    expect(postState(facts({ status: "approved", approvedAt: T(5), webPublishedAt: T(0) }))).toBe("verified");
  });

  it("is corrected or withdrawn once an approved correction or withdrawal replaced it, the entry then being superseded", () => {
    expect(postState(facts({ status: "superseded", approvedAt: T(5), webPublishedAt: T(5), replacedBy: "correction" }))).toBe("corrected");
    expect(postState(facts({ status: "superseded", approvedAt: T(5), webPublishedAt: T(5), replacedBy: "withdrawal" }))).toBe("withdrawn");
    expect(postState(facts({ status: "approved", approvedAt: T(5), webPublishedAt: T(5), replacedBy: "withdrawal" }))).toBe("withdrawn");
  });

  it("is returned for a draft the Hub sent back, declined only for a submitted entry the Hub discarded (S08.02)", () => {
    expect(postState(facts({ status: "draft", submittedAt: null, returnedFor: "return" }))).toBe("returned");
    expect(postState(facts({ status: "discarded", discardReason: "declined" }))).toBe("declined");
  });

  it("is ended, never declined, when its alert closed before the Hub sent it, and no post at all when its author took it back (S08.02)", () => {
    expect(postState(facts({ status: "discarded", discardReason: "by_close" }))).toBe("ended");
    expect(postState(facts({ status: "discarded", discardReason: "by_author" }))).toBeNull();
    // Discarded before the reason was kept: nothing says the Hub declined it, so it is not shown as declined.
    expect(postState(facts({ status: "discarded", discardReason: null }))).toBeNull();
    expect(postState(facts({ status: "discarded" }))).toBeNull();
  });

  it("is no post at all for a draft nobody submitted, one sent back for an edit or a retranslation, or one its author discarded before submitting", () => {
    expect(postState(facts({ status: "draft", submittedAt: null }))).toBeNull();
    expect(postState(facts({ status: "draft", submittedAt: null, returnedFor: "edit" }))).toBeNull();
    expect(postState(facts({ status: "draft", submittedAt: null, returnedFor: "retranslate" }))).toBeNull();
    expect(postState(facts({ status: "discarded", submittedAt: null }))).toBeNull();
    expect(postState(facts({ status: "published_system" }))).toBeNull();
  });

  it("only ever answers with a state the screens have words for", () => {
    const answers = new Set(
      [
        facts({}),
        facts({ webPublishedAt: T(0) }),
        facts({ status: "approved", approvedAt: T(5), webPublishedAt: T(5) }),
        facts({ status: "approved", approvedAt: T(5), webPublishedAt: T(0) }),
        facts({ status: "superseded", replacedBy: "correction" }),
        facts({ status: "superseded", replacedBy: "withdrawal" }),
        facts({ status: "draft", returnedFor: "return" }),
        facts({ status: "discarded", discardReason: "declined" }),
        facts({ status: "discarded", discardReason: "by_close" }),
      ].map(postState),
    );
    expect([...answers].sort()).toEqual([...AMBASSADOR_POST_STATES].sort());
  });
});
