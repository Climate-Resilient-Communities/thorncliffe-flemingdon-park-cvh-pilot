import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AMBASSADOR_POST_STATES, WITHDRAWAL_REASONS, type AmbassadorPostState, type AmbassadorPostStatus } from "@/modules/alerting";
import { FollowForms } from "./FollowForms";
import { ResolveBody, StatusBody } from "./StatusBody";
import { FOLLOW_REASONS, followWords, progressLines, resolveScreen, statusScreen, type StatusData, type TextCounts } from "./view";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e17a";
const IDS = { correct: "01900000-0000-7000-8000-00000000c001", withdraw: "01900000-0000-7000-8000-00000000c002", resolve: "01900000-0000-7000-8000-00000000c003" };
const FLOOR_A = "01900000-0000-7000-8000-0000000f0001";
const FLOOR_B = "01900000-0000-7000-8000-0000000f0002";
const COUNTS: TextCounts = { waiting: 0, inFlight: 0, delivered: 0, undelivered: 0, failed: 0, unknown: 0, cancelled: 0, skipped: 0 };

const status = (over: Partial<AmbassadorPostStatus> = {}): AmbassadorPostStatus => ({
  entryId: ENTRY,
  alertId: ALERT,
  slug: "abcd2345",
  kind: "update",
  types: ["water"],
  text: "No water on floors 3 to 5.",
  phase: "problem",
  state: "live",
  note: null,
  buildings: [{ rsn: "7001", floors: null }],
  postedAt: new Date("2026-10-04T18:30:00.000Z"),
  approvedAt: null,
  validUntil: new Date("2026-10-05T18:30:00.000Z"),
  replacedWith: null,
  waitingReplacement: null,
  waitingFinal: false,
  threadOpen: true,
  can: { replace: false, resolve: false },
  ...over,
});
const data = (over: Partial<AmbassadorPostStatus> = {}, rest: Partial<StatusData> = {}): StatusData => ({
  status: status(over),
  addresses: new Map([["7001", "4 Milepost Pl"]]),
  floorLabels: new Map([[FLOOR_A, "3"], [FLOOR_B, "4"]]),
  counts: null,
  ids: IDS,
  ...rest,
});

describe("where a post stands (A-03, S08.04)", () => {
  it("says 'Live. Not yet verified' for a post residents already read, and that the texts wait for the Hub", () => {
    const state = statusScreen(data()).state;
    expect(state).toMatchObject({ id: "live", title: "Live. Not yet verified" });
    expect(state.body).toMatch(/Text messages go out only after the Hub approves it/);
  });

  it("says 'Waiting for the Hub' for a post nobody reads yet", () => {
    expect(statusScreen(data({ state: "waiting" })).state).toMatchObject({ id: "waiting", title: "Waiting for the Hub", hold: true });
  });

  it("says 'Approved' once approved, for a post that was live before and one that was not", () => {
    for (const state of ["approved", "verified"] as const) {
      expect(statusScreen(data({ state, approvedAt: new Date("2026-10-04T19:00:00.000Z") })).state).toMatchObject({ id: state, title: "Approved" });
    }
  });

  it("says 'Returned to you' with the Hub's note", () => {
    const screen = statusScreen(data({ state: "returned", note: "Add the floors." }));
    expect(screen.state).toMatchObject({ id: "returned", title: "Returned to you", note: "Note from the Hub: Add the floors." });
    expect(renderToStaticMarkup(<StatusBody screen={screen} />)).toContain('data-testid="status-note">Note from the Hub: Add the floors.</p>');
  });

  it("says 'Withdrawn' with what residents read instead, and 'Corrected' the same way", () => {
    const withdrawn = statusScreen(data({ state: "withdrawn", replacedWith: { entryId: ALERT, kind: "withdrawal", text: "This report was withdrawn.", at: new Date("2026-10-04T19:00:00.000Z") } }));
    expect(withdrawn.state).toMatchObject({ title: "Withdrawn", note: "Residents read instead: This report was withdrawn." });
    const corrected = statusScreen(data({ state: "corrected", replacedWith: { entryId: ALERT, kind: "correction", text: "Water is off on floors 3 to 4.", at: new Date("2026-10-04T19:00:00.000Z") } }));
    expect(corrected.state).toMatchObject({ title: "Corrected", note: "Residents read instead: Water is off on floors 3 to 4." });
  });

  it("words every state the home can show, none left to a raw code", () => {
    for (const state of AMBASSADOR_POST_STATES as readonly AmbassadorPostState[]) {
      const shown = statusScreen(data({ state })).state;
      expect(shown.title, state).not.toBe("");
      expect(shown.title, state).not.toMatch(/^[a-z_]+$/);
      expect(shown.body, state).not.toBe("");
    }
  });

  it("tells what else waits for the Hub: a correction, a withdrawal, a final message", () => {
    const waiting = (over: Partial<AmbassadorPostStatus>) => statusScreen(data(over)).waiting;
    expect(waiting({ waitingReplacement: { entryId: ALERT, kind: "correction", text: "x", at: new Date() } })).toEqual([expect.stringMatching(/Your correction is waiting for the Hub/)]);
    expect(waiting({ waitingReplacement: { entryId: ALERT, kind: "withdrawal", text: "x", at: new Date() } })).toEqual([expect.stringMatching(/Your withdrawal is waiting for the Hub/)]);
    expect(waiting({ waitingFinal: true })).toEqual([expect.stringMatching(/final message for this alert is waiting for the Hub/)]);
    expect(waiting({})).toEqual([]);
  });

  it("names the building and floors as the post has them: the whole building, one floor, or the floors listed", () => {
    expect(statusScreen(data()).yours.floors).toBe("4 Milepost Pl: whole building");
    expect(statusScreen(data({ buildings: [{ rsn: "7001", floors: [FLOOR_A] }] })).yours.floors).toBe("4 Milepost Pl: floor 3");
    expect(statusScreen(data({ buildings: [{ rsn: "7001", floors: [FLOOR_A, FLOOR_B] }] })).yours.floors).toBe("4 Milepost Pl: some floors 3, 4");
    expect(statusScreen(data()).yours.meta.at(-1)).toBe("This will appear as: Building ambassador, 4 Milepost Pl");
  });
});

describe("the texts' progress once approved (A-03, S08.04)", () => {
  it("shows waiting, on their way, delivered and not delivered, where not delivered counts failed, undelivered and unclear texts and cancelled ones are no part of it", () => {
    const lines = progressLines({ ...COUNTS, waiting: 5, inFlight: 3, delivered: 40, undelivered: 2, failed: 1, unknown: 1, cancelled: 9, skipped: 4 });
    expect(lines.map((line) => [line.id, line.n, line.text])).toEqual([
      ["waiting", 5, "5 waiting to be sent"],
      ["inFlight", 3, "3 on their way"],
      ["delivered", 40, "40 delivered"],
      ["failed", 4, "4 not delivered"],
    ]);
  });

  it("is shown only for an approved post, and says so when no text was queued", () => {
    expect(statusScreen(data({ state: "live" }, { counts: { ...COUNTS, delivered: 3 } })).progress).toBeNull();
    const none = statusScreen(data({ state: "approved" }, { counts: COUNTS })).progress;
    expect(none).toMatchObject({ title: "Text messages", none: "No text messages were queued for this update.", lines: [] });
    const some = statusScreen(data({ state: "approved" }, { counts: { ...COUNTS, delivered: 3, waiting: 1 } })).progress;
    expect(some?.none).toBeNull();
    expect(some?.lines.map((line) => line.n)).toEqual([1, 0, 3, 0]);
    const html = renderToStaticMarkup(<StatusBody screen={statusScreen(data({ state: "approved" }, { counts: { ...COUNTS, delivered: 3, waiting: 1 } }))} />);
    expect(html).toContain('data-count="delivered" data-n="3">3 delivered</li>');
  });
});

describe("what the person may do about it (A-03, S08.04)", () => {
  it("offers correct and withdraw only when the use case would allow them, and resolve only for an alert about their one building", () => {
    expect(statusScreen(data()).follow).toBeNull();
    const both = statusScreen(data({ can: { replace: true, resolve: true } })).follow;
    expect(both).toMatchObject({ alertId: ALERT, postId: ENTRY, correct: { entryId: IDS.correct, phase: "problem", text: "No water on floors 3 to 5." }, withdraw: { entryId: IDS.withdraw }, resolve: { entryId: IDS.resolve } });
    const resolveOnly = statusScreen(data({ can: { replace: false, resolve: true } })).follow;
    expect(resolveOnly).toMatchObject({ correct: null, withdraw: null, resolve: { entryId: IDS.resolve } });
  });

  it("keeps the reasons of a withdrawal equal to the alerting module's catalog, each with its English words", () => {
    expect([...FOLLOW_REASONS]).toEqual([...WITHDRAWAL_REASONS]);
    expect(followWords().withdraw.reasons).toEqual([
      { id: "wrong_place", label: "Wrong place" },
      { id: "wrong_information", label: "Wrong information" },
      { id: "duplicate", label: "Duplicate of another alert" },
      { id: "other", label: "Other (write the reason)" },
    ]);
  });

  it("names every refusal the follow-up can meet in words, and a general one for the rest", () => {
    const { errors } = followWords();
    for (const code of ["OUT_OF_SCOPE", "NOT_ALLOWED", "AUTHOR_NOT_ALLOWED", "ONE_BUILDING_ONLY", "TARGET_NOT_VALID", "TARGET_SUPERSEDED", "TARGET_NOT_PUBLISHED", "ALERT_CLOSED", "NO_PUBLISHED_ENTRY", "WITHDRAWAL_REASON_INVALID", "TEXT_EMPTY", "VALID_UNTIL_PAST"]) {
      expect(errors[code], code).toMatch(/\S/);
    }
    expect(errors.TARGET_NOT_PUBLISHED).toMatch(/Residents have not read that update yet/);
    expect(errors.fallback).toBe("This was not sent. Try again. If it keeps happening, call the Hub.");
  });

  it("draws the three forms, closed until chosen, with the correction's words ready to change", () => {
    const screen = statusScreen(data({ can: { replace: true, resolve: true } }));
    const html = renderToStaticMarkup(<StatusBody screen={screen} />);
    for (const words of ["Correct this update", "Withdraw this update", "Mark resolved", "Send the correction", "Why?", "Final message, in English", "No water on floors 3 to 5."]) {
      expect(html, words).toContain(words);
    }
    expect(html).not.toMatch(/<details[^>]* open/);
  });

  it("draws only the resolve form on its page, or says a final message already waits", () => {
    const form = resolveScreen({ alertId: ALERT, headline: "Power is out in 4 Milepost Pl.", waitingFinal: false, entryId: IDS.resolve });
    const html = renderToStaticMarkup(<ResolveBody screen={form} />);
    expect(html).toContain("The alert: Power is out in 4 Milepost Pl.");
    expect(html).toContain("Send the final message");
    expect(html).not.toContain("Correct this update");
    const waiting = resolveScreen({ alertId: ALERT, headline: "Power is out.", waitingFinal: true, entryId: IDS.resolve });
    expect(waiting.follow).toBeNull();
    expect(renderToStaticMarkup(<ResolveBody screen={waiting} />)).toContain("already waiting for the Hub");
  });

  it("shows the unsent-request notice and a refusal in words once the sender says so", () => {
    const screen = statusScreen(data({ can: { replace: true, resolve: true } })).follow!;
    const quiet = () => ({ press: () => undefined, state: () => ({ kind: "idle" as const }), stop: () => undefined });
    const held = renderToStaticMarkup(<FollowForms screen={screen} sender={quiet} initial={{ open: "resolve", state: { kind: "unsent" }, action: "resolve" }} />);
    expect(held).toContain("Not sent yet. Keep this page open; it sends when you have signal.");
    const refused = renderToStaticMarkup(<FollowForms screen={screen} sender={quiet} initial={{ open: "correct", state: { kind: "error", code: "TARGET_NOT_PUBLISHED" } }} />);
    expect(refused).toContain('data-testid="follow-error"');
    expect(refused).toContain("Residents have not read that update yet");
    const done = renderToStaticMarkup(<FollowForms screen={screen} sender={quiet} initial={{ state: { kind: "done", live: true }, action: "correct" }} />);
    expect(done).toContain("Sent to the Hub");
    expect(done).toContain("Residents read it now as");
    const resolved = renderToStaticMarkup(<FollowForms screen={screen} sender={quiet} initial={{ state: { kind: "done" }, action: "resolve" }} />);
    expect(resolved).toContain("The alert stays open until the Hub approves your final message.");
  });
});
