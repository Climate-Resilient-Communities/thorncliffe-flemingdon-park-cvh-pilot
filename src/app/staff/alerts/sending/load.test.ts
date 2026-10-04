// What the sending progress pages load (S06.09), over a fake use case and fake counts: the block is shown for an approved entry of a real alert, a drill is
// pointed to the Drills page, an entry that is not approved has no texts, and the pause sentence follows the switch. No database.
import { describe, expect, it, vi } from "vitest";
import { progressOf, type EntryProgress } from "@/modules/messaging";
import { ALERT, ENTRY, reviewOf, type ReviewOptions } from "../../../../../test/helpers/approvalReview";
import { loadProblemList, loadSending, sendingBlock, stateOfQuery, type SendingDeps } from "./load";

type Row = Parameters<typeof progressOf>[0][number];
const rows = (lang: string, state: Row["state"], n: number, handedOff = false): Row[] => Array.from({ length: n }, () => ({ lang, state, handedOff }));
const waitingAndSent = progressOf([...rows("en", "queued", 3), ...rows("en", "delivered", 5, true), ...rows("ur", "failed", 1)]);

const approved: ReviewOptions = { entry: { status: "approved" } };

function deps(options: { review?: ReviewOptions | null; progress?: EntryProgress; paused?: () => Promise<boolean>; forEntry?: () => Promise<EntryProgress>; problemTexts?: () => Promise<never> } = {}) {
  const logError = vi.fn();
  const forEntry = vi.fn(options.forEntry ?? (async () => options.progress ?? waitingAndSent));
  const problemTexts = vi.fn(options.problemTexts ?? (async () => ({ texts: [{ id: "01900000-0000-7000-8000-00000abc1234", reference: "abc123", lang: "ur", state: "failed" as const, meaning: "not_in_service" as const, code: null, at: new Date("2026-10-05T18:15:00Z") }], more: false })));
  const paused = vi.fn(options.paused ?? (async () => false));
  const review = vi.fn(async () => (options.review === null ? null : reviewOf(options.review ?? approved)));
  const wired: SendingDeps = { review, progress: { forEntry, problemTexts }, paused, logError };
  return { wired, review, forEntry, problemTexts, paused, logError };
}

const query = { alert: ALERT, entry: ENTRY };

describe("the alert's staff view of the sending progress", () => {
  it("reads the entry the query names, and shows the counts of an approved entry", async () => {
    const d = deps();
    const screen = await loadSending({ alert: [ALERT, "other"], entry: ENTRY, ignored: "x" } as never, d.wired);
    expect(d.review).toHaveBeenCalledWith({ alertId: ALERT, entryId: ENTRY });
    expect(d.forEntry).toHaveBeenCalledWith(ENTRY);
    expect(screen).toMatchObject({ kind: "screen", ref: { alertId: ALERT, entryId: ENTRY }, notice: null, block: { kind: "progress" } });
    if (screen.kind !== "screen" || screen.block?.kind !== "progress") throw new Error("expected a progress block");
    expect(screen.block.view.languages.map((language) => language.lang)).toEqual(["en", "ur"]);
    expect(screen.back.href).toBe(`/staff/alerts/approve?alert=${ALERT}&entry=${ENTRY}`);
  });

  it("is the screen for an entry that is not there, and reads no counts for it", async () => {
    const d = deps({ review: null });
    expect(await loadSending(query, d.wired)).toMatchObject({ kind: "missing", message: "That alert entry was not found." });
    expect(await loadSending({}, d.wired)).toMatchObject({ kind: "missing" });
    expect(d.forEntry).not.toHaveBeenCalled();
  });

  it("sends a drill to the Drills page and reads none of its counts here: drills have their own view", async () => {
    const d = deps({ review: { ...approved, thread: { isDrill: true } } });
    const screen = await loadSending(query, d.wired);
    expect(screen).toMatchObject({ kind: "screen", block: null, notice: { message: expect.stringMatching(/practice alert/), link: { href: "/staff/drills" } } });
    expect(d.forEntry).not.toHaveBeenCalled();
    expect(d.paused).not.toHaveBeenCalled();
  });

  it("says an entry that is not approved has no texts, and reads none", async () => {
    for (const status of ["pending_approval", "draft", "discarded"] as const) {
      const d = deps({ review: { entry: { status } } });
      expect(await loadSending(query, d.wired), status).toMatchObject({ block: null, notice: { message: "This entry has not been approved, so no texts have been made for it." } });
      expect(d.forEntry).not.toHaveBeenCalled();
    }
  });
});

describe("the sentence about texts already handed to the provider, with a fake pause", () => {
  const sentenceOf = async (progress: EntryProgress, paused: boolean) => {
    const d = deps({ progress, paused: async () => paused });
    const block = await sendingBlock(reviewOf(approved), d.wired);
    return block?.kind === "progress" ? block.view.handedOff : "no block";
  };

  it("is shown while paused and not otherwise: for many, for one, and for none", async () => {
    const many = progressOf([...rows("en", "queued", 2), ...rows("en", "delivered", 4, true)]);
    const one = progressOf([...rows("en", "queued", 2), ...rows("en", "delivered", 1, true)]);
    const none = progressOf([...rows("en", "queued", 2)]);
    expect(await sentenceOf(many, true)).toBe("4 texts were already handed to the provider and cannot be recalled");
    expect(await sentenceOf(one, true)).toBe("1 text was already handed to the provider and cannot be recalled");
    expect(await sentenceOf(none, true)).toBeNull();
    for (const progress of [many, one, none]) expect(await sentenceOf(progress, false)).toBeNull();
  });

  it("counts the in-flight text a pause let go during an open hand-off, which is claimed with a hand-off", async () => {
    const progress = progressOf([...rows("en", "queued", 2), ...rows("en", "claimed", 1, true)]);
    expect(await sentenceOf(progress, true)).toBe("1 text was already handed to the provider and cannot be recalled");
    const block = await sendingBlock(reviewOf(approved), deps({ progress, paused: async () => true }).wired);
    if (block?.kind !== "progress") throw new Error("expected a progress block");
    expect(block.view.languages[0].counts.find((count) => count.id === "inFlight")?.n).toBe(1);
  });

  it("does not ask the switch when nothing of the entry waits", async () => {
    const d = deps({ progress: progressOf(rows("en", "delivered", 3, true)), paused: async () => true });
    const block = await sendingBlock(reviewOf(approved), d.wired);
    expect(d.paused).not.toHaveBeenCalled();
    expect(block).toMatchObject({ kind: "progress", view: { handedOff: null } });
  });
});

describe("a failure to read", () => {
  it("is logged by the error's name and becomes a note in the block's place, never an exception", async () => {
    const d = deps({ forEntry: async () => Promise.reject(new TypeError("database is down")) });
    const block = await sendingBlock(reviewOf(approved), d.wired);
    expect(block).toEqual({ kind: "unavailable", note: expect.stringMatching(/could not be read/) });
    expect(d.logError).toHaveBeenCalledWith("sending.progress_failed", { error: "TypeError" });
    expect(JSON.stringify(d.logError.mock.calls)).not.toContain("database is down");
  });
});

describe("the list of the texts that did not arrive", () => {
  it("reads the entry's texts in the state asked for", async () => {
    const d = deps();
    const screen = await loadProblemList({ ...query, state: "failed" }, d.wired);
    expect(d.problemTexts).toHaveBeenCalledWith(ENTRY, "failed");
    expect(screen).toMatchObject({ kind: "list", list: { state: "failed", items: [{ meaning: "Number not in service" }] } });
  });

  it("is logged by the error's name and becomes the unavailable note with the way back, never an exception", async () => {
    const d = deps({ problemTexts: async () => Promise.reject(new TypeError("database is down")) });
    const screen = await loadProblemList({ ...query, state: "failed" }, d.wired);
    expect(screen).toMatchObject({ kind: "missing", message: expect.stringMatching(/could not be read/), back: { href: "/staff" } });
    expect(d.logError).toHaveBeenCalledWith("sending.problems_failed", { error: "TypeError" });
    expect(JSON.stringify(d.logError.mock.calls)).not.toContain("database is down");
  });

  it("understands the three states and nothing else", () => {
    expect(stateOfQuery({ state: "unknown" })).toBe("unknown");
    expect(stateOfQuery({ state: ["undelivered", "failed"] })).toBe("undelivered");
    for (const state of [undefined, "", "delivered", "queued", "FAILED", "failed;drop"]) expect(stateOfQuery({ state }), String(state)).toBeNull();
  });

  it("is the screen for an entry that is not there for a state it does not know, a drill, and an entry that is not approved, reading no texts", async () => {
    for (const [state, review] of [
      ["delivered", approved],
      [undefined, approved],
      ["failed", null],
      ["failed", { ...approved, thread: { isDrill: true } }],
      ["failed", { entry: { status: "pending_approval" } }],
    ] as const) {
      const d = deps({ review: review as ReviewOptions | null });
      expect(await loadProblemList({ ...query, state }, d.wired), String(state)).toMatchObject({ kind: "missing" });
      expect(d.problemTexts).not.toHaveBeenCalled();
    }
  });
});
