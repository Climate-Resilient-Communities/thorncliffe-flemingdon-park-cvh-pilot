import { describe, expect, it } from "vitest";
import type { CampaignOverview, CampaignSummary } from "@/modules/subscriptions";
import { campaignPageText, campaignScreen, namedStaff, type ScreenInput } from "./view";

// What the End of the pilot page says in each phase (S09.07), from the campaign as subscriptions reads it. The page's markup is drawn by the Hub's screenshot tests
// (e2e/hub/campaign.spec.ts); the behaviour behind it is test/db/campaign.db.test.ts.
const ADMIN = "01900000-0000-7000-8000-0000000000a1";
const OTHER = "01900000-0000-7000-8000-0000000000a2";
const ZERO = { waiting: 0, handedOff: 0, delivered: 0, notDelivered: 0, unknown: 0 };

const summary = (over: Partial<CampaignSummary> = {}): CampaignSummary => ({
  id: "01900000-0000-7000-8000-0000000000c1",
  deadlineDate: "2026-12-05",
  state: "started",
  startedBy: ADMIN,
  startedAt: new Date("2026-11-05T15:00:00Z"),
  endedAt: null,
  signupsReopenedAt: null,
  signupsReopenedBy: null,
  ...over,
});

const overview = (over: Partial<CampaignOverview> = {}): CampaignOverview => ({
  deadlineDate: "2026-12-05",
  texts: { en: { body: "The CVH pilot is ending. Reply YES to keep getting alerts. If you do not reply by December 5, your number will be deleted.", segments: 1 } } as CampaignOverview["texts"],
  estimate: { byLanguage: [{ lang: "ur", subscribers: 41, costCents: 123 }, { lang: "en", subscribers: 120, costCents: 180 }], subscribers: 161, costCents: 303 },
  rosterSize: 3,
  rehearsal: null,
  campaign: null,
  signupsClosed: false,
  counts: { asked: 0, kept: 0, active: 161, lapsed: 0 },
  termsVersion: "2026-11-02.2",
  ...over,
});

const input = (over: Partial<ScreenInput> = {}): ScreenInput => ({ overview: overview(), names: new Map([[ADMIN, "Ann Okafor"]]), rehearsalTexts: null, campaignTexts: null, capNotice: null, ...over });

describe("the End of the pilot page", () => {
  it("before a rehearsal offers only the rehearsal: the start shows what it would do and says to rehearse first", () => {
    const screen = campaignScreen(input());
    expect(screen.phase).toBe("not_started");
    expect(screen.rehearsal).toEqual({ roster: "Phones on the drill roster: 3", emptyRoster: null, last: "No rehearsal yet.", canRehearse: true, texts: null });
    expect(screen.start).toMatchObject({
      deadlineDate: "2026-12-05",
      deadline: "Deadline: Saturday, December 5, 2026, end of day in Toronto.",
      asked: "Subscribers who will be asked: 161",
      languages: [
        { language: "English", subscribers: 120 },
        { language: "Urdu", subscribers: 41 },
      ],
      noSubscribers: null,
      cost: "Estimated cost: $3.03 CAD for 161 texts.",
      needsRehearsal: "Rehearse on the drill roster first: the campaign starts only after a rehearsal.",
    });
    expect(screen.running).toBeNull();
    expect(screen.signups).toEqual({ line: "Sign-ups are open.", hint: null, canReopen: false });
  });

  it("after a rehearsal says when, by whom and what became of its texts, and offers the start with the cap's sentence", () => {
    const screen = campaignScreen(
      input({ overview: overview({ rehearsal: summary({ id: "r1", startedBy: OTHER }) }), names: new Map([[OTHER, "Priya Sharma"]]), rehearsalTexts: { ...ZERO, delivered: 2, unknown: 1, handedOff: 3 }, capNotice: "over the cap" }),
    );
    expect(screen.rehearsal!.last).toBe("Last rehearsal: Nov 5, 2026, 10:00 a.m., by Priya Sharma.");
    expect(screen.rehearsal!.texts).toBe("Its texts: 0 waiting, 3 handed to the provider, 2 delivered, 0 not delivered, 1 with an unknown outcome.");
    expect(screen.start!.needsRehearsal).toBeNull();
    expect(screen.start!.capNotice).toBe("over the cap");
  });

  it("says an empty roster reaches nobody, and that there is nobody to ask", () => {
    const screen = campaignScreen(input({ overview: overview({ rosterSize: 0, estimate: { byLanguage: [], subscribers: 0, costCents: 0 } }) }));
    expect(screen.rehearsal!.emptyRoster).toMatch(/drill roster is empty/);
    expect(screen.rehearsal!.canRehearse).toBe(false);
    expect(screen.start!.noSubscribers).toBe("There are no subscribers to ask.");
  });

  it("while it runs says who started it, the deadline, how many are asked and stayed, and that sign-ups are paused", () => {
    const screen = campaignScreen(input({ overview: overview({ campaign: summary(), counts: { asked: 120, kept: 41, active: 0, lapsed: 0 } }), campaignTexts: { ...ZERO, waiting: 4, delivered: 150 } }));
    expect(screen.phase).toBe("running");
    expect(screen.rehearsal).toBeNull();
    expect(screen.start).toBeNull();
    expect(screen.running).toEqual({
      started: "Started Nov 5, 2026, 10:00 a.m. by Ann Okafor.",
      deadline: "Deadline: Saturday, December 5, 2026, end of day in Toronto.",
      asked: "Asked and not yet replied: 120",
      kept: "Replied YES and stay: 41",
      texts: "Campaign texts: 4 waiting, 0 handed to the provider, 150 delivered, 0 not delivered, 0 with an unknown outcome.",
    });
    expect(screen.signups.canReopen).toBe(false);
    expect(screen.signups.line).toMatch(/^Sign-ups are paused while the pilot ends/);
  });

  it("after the deadline says who stayed and who did not, and offers to reopen sign-ups; once reopened, says when and by whom", () => {
    const ended = summary({ state: "ended", endedAt: new Date("2026-12-06T05:15:00Z") });
    const screen = campaignScreen(input({ overview: overview({ campaign: ended, counts: { asked: 0, kept: 41, active: 0, lapsed: 79 } }) }));
    expect(screen.phase).toBe("ended");
    expect(screen.ended).toEqual({
      when: "Ended Dec 6, 2026, 12:15 a.m.; the deadline was Saturday, December 5, 2026.",
      kept: "Replied YES and stay: 41",
      lapsed: "Did not reply, to be deleted: 79",
      purge: "Subscribers who did not reply receive nothing and are deleted by the end-of-pilot purge.",
    });
    expect(screen.signups).toMatchObject({ canReopen: true, hint: "Reopen them when the MVP is ready to take new subscribers." });
    const reopened = campaignScreen(input({ overview: overview({ campaign: { ...ended, signupsReopenedAt: new Date("2026-12-07T15:00:00Z"), signupsReopenedBy: ADMIN } }) }));
    expect(reopened.signups).toEqual({ line: "Sign-ups were reopened Dec 7, 2026, 10:00 a.m. by Ann Okafor.", hint: null, canReopen: false });
  });

  it("names an Admin whose account cannot be read as an Admin, and reads the names it needs once", () => {
    expect(campaignScreen(input({ overview: overview({ campaign: summary() }), names: new Map() })).running!.started).toMatch(/by an Admin\.$/);
    expect(namedStaff(overview({ rehearsal: summary({ startedBy: OTHER }), campaign: summary({ signupsReopenedBy: ADMIN }) }))).toEqual([OTHER, ADMIN]);
  });

  it("resolves the page's fixed words on the server", () => {
    expect(campaignPageText()).toMatchObject({ title: "End of the pilot", "rehearsal.heading": "Rehearse on the drill roster", "signups.heading": "Sign-ups" });
  });
});
