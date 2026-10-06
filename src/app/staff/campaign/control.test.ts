import { describe, expect, it } from "vitest";
import type { CampaignRehearseOutcome, CampaignReopenOutcome, CampaignStartInput, CampaignStartOutcome, Campaigns, CampaignSummary } from "@/modules/subscriptions";
import { refusalMessage, rehearseFromForm, reopenFromForm, startFromForm, type ControlDeps } from "./control";

// The End of the pilot page's three presses (S09.07): what each sends the use case (the session's Admin and session, the page's key and deadline, the box), what
// it answers, when it starts the sender, and that a failure says nothing changed. The use case itself is test/db/campaign.db.test.ts's.
const SESSION = { staffId: "01900000-0000-7000-8000-0000000000a1", sessionId: "a".repeat(64) };
const KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";
const CAMPAIGN: CampaignSummary = {
  id: "01900000-0000-7000-8000-0000000000c1",
  deadlineDate: "2026-12-05",
  state: "started",
  startedBy: SESSION.staffId,
  startedAt: new Date(),
  endedAt: null,
  signupsReopenedAt: null,
  signupsReopenedBy: null,
};

function world(answers: { rehearse?: CampaignRehearseOutcome; start?: CampaignStartOutcome; reopen?: CampaignReopenOutcome; fail?: boolean } = {}) {
  const calls: { kind: string; input: unknown }[] = [];
  const logged: string[] = [];
  let kicks = 0;
  const fail = () => {
    if (answers.fail) throw new TypeError("connect ECONNREFUSED");
  };
  const campaigns = {
    async rehearse(input: unknown) {
      calls.push({ kind: "rehearse", input });
      fail();
      return answers.rehearse ?? { kind: "rehearsed", campaign: CAMPAIGN, texts: 3, replayed: false };
    },
    async start(input: CampaignStartInput) {
      calls.push({ kind: "start", input });
      fail();
      return answers.start ?? { kind: "started", campaign: CAMPAIGN, asked: 161, texts: 161, pendingDeleted: 4, costCents: 303, overrun: null };
    },
    async reopenSignups(input: unknown) {
      calls.push({ kind: "reopen", input });
      fail();
      return answers.reopen ?? { kind: "reopened", at: new Date() };
    },
  } as unknown as Campaigns;
  const deps: ControlDeps = { campaigns: () => campaigns, startSending: async () => void (kicks += 1), logError: (event, fields) => void logged.push(`${event} ${JSON.stringify(fields)}`) };
  return { deps, calls, logged, kicks: () => kicks };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe("Rehearse on the drill roster", () => {
  it("sends the session's Admin and session, the page's key and the deadline it showed, then starts the sender", async () => {
    const w = world();
    expect(await rehearseFromForm(w.deps, SESSION, form({ key: KEY, deadline: "2026-12-05" }))).toEqual({ status: "done", lines: ["The rehearsal text is queued for 3 staff phones."] });
    expect(w.calls).toEqual([{ kind: "rehearse", input: { actorStaffId: SESSION.staffId, sessionId: SESSION.sessionId, idempotencyKey: KEY, deadlineSeen: "2026-12-05" } }]);
    expect(w.kicks()).toBe(1);
  });

  it("says a retried request changed nothing, and an empty roster that no text was queued, starting no sender", async () => {
    const again = world({ rehearse: { kind: "rehearsed", campaign: CAMPAIGN, texts: 0, replayed: true } });
    expect(await rehearseFromForm(again.deps, SESSION, form({ key: KEY }))).toEqual({ status: "done", lines: ["This rehearsal was already sent. Nothing changed."] });
    const empty = world({ rehearse: { kind: "rehearsed", campaign: CAMPAIGN, texts: 0, replayed: false } });
    expect((await rehearseFromForm(empty.deps, SESSION, form({ key: KEY }))).status).toBe("done");
    expect(again.kicks() + empty.kicks()).toBe(0);
  });
});

describe("Start the campaign", () => {
  it("sends the box the Admin ticked with the key and the deadline, says what it did, and starts the sender", async () => {
    const w = world();
    const answer = await startFromForm(w.deps, SESSION, form({ key: KEY, deadline: "2026-12-05", confirm: "yes" }));
    expect(answer).toEqual({ status: "done", lines: ["The campaign has started: 161 subscribers are asked, 161 texts are queued and 4 pending sign-ups were deleted. Sign-ups are paused."] });
    expect(w.calls[0]!.input).toEqual({ actorStaffId: SESSION.staffId, sessionId: SESSION.sessionId, idempotencyKey: KEY, deadlineSeen: "2026-12-05", confirmed: true });
    expect(w.kicks()).toBe(1);
  });

  it("passes an unticked box as not confirmed, and says why a start was refused, naming a deadline that changed", async () => {
    const w = world({ start: { kind: "refused", reason: "deadline_changed", deadlineDate: "2026-12-06" } });
    expect(await startFromForm(w.deps, SESSION, form({ key: KEY, deadline: "2026-12-05" }))).toEqual({
      status: "refused",
      message: "The deadline has changed since this page was opened: it is now Sunday, December 6, 2026. Check it, then start again.",
    });
    expect((w.calls[0]!.input as CampaignStartInput).confirmed).toBe(false);
    expect(w.kicks()).toBe(0);
    const again = world({ start: { kind: "already_started", campaign: CAMPAIGN } });
    expect(await startFromForm(again.deps, SESSION, form({ key: KEY }))).toEqual({ status: "done", lines: ["The campaign had already started. Nothing changed."] });
    expect(again.kicks()).toBe(0);
  });

  it("says every refusal in words", () => {
    for (const reason of ["key_invalid", "terms_unavailable", "rehearsal_needed", "roster_empty", "already_started", "not_confirmed", "not_ended", "already_reopened", "no_campaign"] as const) {
      expect(refusalMessage(reason), reason).not.toMatch(/staff\.campaign|\{/);
    }
  });
});

describe("Reopen sign-ups for the MVP", () => {
  it("reopens as the session's Admin, or says why not", async () => {
    const w = world();
    expect(await reopenFromForm(w.deps, SESSION)).toEqual({ status: "done", lines: ["Sign-ups are open again."] });
    expect(w.calls).toEqual([{ kind: "reopen", input: { actorStaffId: SESSION.staffId } }]);
    const early = world({ reopen: { kind: "refused", reason: "not_ended" } });
    expect(await reopenFromForm(early.deps, SESSION)).toEqual({ status: "refused", message: "Sign-ups can be reopened only after the campaign has ended." });
  });
});

describe("a failure", () => {
  it("says nothing changed and logs the error's name only, for each press", async () => {
    const w = world({ fail: true });
    const failed = { status: "refused", message: "Nothing changed. Try again. If it fails again, tell IT." };
    expect(await rehearseFromForm(w.deps, SESSION, form({ key: KEY }))).toEqual(failed);
    expect(await startFromForm(w.deps, SESSION, form({ key: KEY }))).toEqual(failed);
    expect(await reopenFromForm(w.deps, SESSION)).toEqual(failed);
    expect(w.logged).toEqual(['campaign.rehearse_failed {"error":"TypeError"}', 'campaign.start_failed {"error":"TypeError"}', 'campaign.reopen_failed {"error":"TypeError"}']);
    expect(w.kicks()).toBe(0);
  });
});
