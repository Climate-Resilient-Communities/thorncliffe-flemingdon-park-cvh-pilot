// UAT F-2: an alert the Hub approved that then expires reads, on the resident's alert page and in the feed, as the Hub's verified alert that ended, never as
// "Not yet verified". The expire job's final (S05.04, `published_system`) is never approved; residentThreads gives it the origin of the entry it closed, and
// the resident screens read the origin of the entry that stands, which is that final.
import { describe, expect, it } from "vitest";
import { FeedThreadSchema } from "../src/contracts/feed";
import { assembleClosedThread, type ResidentEntryRow } from "../src/modules/alerting/domain/residentThreads";
import { translatorFor } from "../src/ui/alert/alert-test-helpers";
import { alertView } from "../src/ui/alert/alert-view";

const row = (over: Partial<ResidentEntryRow>): ResidentEntryRow => ({
  threadId: "0198a000-0000-7000-8000-0000000000a1",
  slug: "kbcdfghj",
  entryId: "0198a000-0000-7000-8000-000000000101",
  kind: "update",
  phase: "problem",
  types: ["heat"],
  audience: { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["heat"] },
  validUntil: new Date("2026-10-08T22:06:00Z"),
  originalText: "Heat warning in Thorncliffe Park until 6:06 p.m.",
  publishedAt: new Date("2026-10-08T21:00:00Z"),
  verified: true,
  superseded: false,
  translation: null,
  ...over,
});
const EXPIRY = row({
  entryId: "0198a000-0000-7000-8000-000000000102",
  kind: "final",
  verified: false,
  originalText: "This alert has expired without a further update. The problem may continue. Contact the Hub for current information.",
  publishedAt: new Date("2026-10-08T22:07:00Z"),
});

describe("an expired alert, as residents read it (UAT F-2)", () => {
  it("is the Hub's verified alert, labelled Expired, when the Hub approved what it said", () => {
    const thread = assembleClosedThread([row({}), EXPIRY], "en", "expired")!;
    expect(FeedThreadSchema.safeParse(thread).success).toBe(true);
    const view = alertView(thread, { lang: "en", serverNow: new Date("2026-10-08T22:10:00Z"), t: translatorFor("en") });
    expect(view.origin).toMatchObject({ attribution: "Community alert from the Hub", verified: true, verification: "Verified by the Hub" });
    expect(view.closed).toMatchObject({ reason: "expired", icon: "clock" });
  });

  it("stays a post nobody verified when it was one that ran out before anyone approved it", () => {
    const thread = assembleClosedThread([row({ verified: false, attributedRsn: "4154146" }), EXPIRY], "en", "expired")!;
    const view = alertView(thread, { lang: "en", serverNow: new Date("2026-10-08T22:10:00Z"), t: translatorFor("en") });
    expect(view.origin).toMatchObject({ verified: false, verification: "Not yet verified" });
    expect(view.origin.attribution).not.toBe("Community alert from the Hub");
  });
});
