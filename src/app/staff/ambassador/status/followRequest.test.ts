import { describe, expect, it, vi } from "vitest";
import { AmbassadorFollowRequestSchema, type AmbassadorFollowRequest } from "@/contracts/ambassadorFollow";
import { followAndSubmit, type FollowDeps } from "./followRequest";

const ALERT = "01900000-0000-7000-8000-000000000001";
const ENTRY = "01900000-0000-7000-8000-000000000002";
const TARGET = "01900000-0000-7000-8000-000000000003";
const NOW = new Date("2026-10-04T15:00:00.000Z");
const KEY = "k".repeat(32);
const AMBASSADOR = { staffId: "01900000-0000-7000-8000-0000000000c1", aal: "aal1" as const, role: "ambassador" as const };

const draft = (kind: string) => ({
  ok: true as const,
  value: {
    thread: { id: ALERT },
    entry: { id: ENTRY, kind, status: "draft", content: { text: "x", types: ["power"], audience: { scope: "buildings", buildings: [], groups: [], types: ["power"] }, phase: "problem", validUntil: NOW, validUntilMode: "resolved" } },
  },
});

function deps(report: unknown = { state: "committed", key: KEY, outcome: null, webPublished: true }) {
  const afterSubmit = vi.fn();
  const submit = vi.fn(async () => report);
  const correctEntry = vi.fn(async () => draft("correction"));
  const withdrawEntry = vi.fn(async () => draft("withdrawal"));
  const startFinal = vi.fn(async () => draft("final"));
  const wired = { alerting: () => ({ correctEntry, withdrawEntry, startFinal }), submitter: () => ({ submit, state: vi.fn(async () => null) }), now: () => NOW, afterSubmit } as unknown as FollowDeps;
  return { wired, afterSubmit, submit, correctEntry, withdrawEntry, startFinal };
}

const base = { v: 1 as const, alert_id: ALERT, entry_id: ENTRY, key: KEY };
const correct: AmbassadorFollowRequest = { ...base, action: "correct", target: TARGET, phase: "problem", valid: { mode: "resolved" }, text: "  Water is off on floors 3 to 4.\r\n" };
const withdraw: AmbassadorFollowRequest = { ...base, action: "withdraw", target: TARGET, reason: "wrong_place", text: "It was the next building." };
const resolve: AmbassadorFollowRequest = { ...base, action: "resolve", text: "Water is back on." };

describe("an ambassador following up on their post (S08.04)", () => {
  it("corrects the post they name with the words, where things stand and until when, then submits it with the page's key and the draft's fingerprint", async () => {
    const d = deps();
    const result = await followAndSubmit(d.wired, AMBASSADOR, correct);
    expect(result).toMatchObject({ state: "committed" });
    expect(d.correctEntry).toHaveBeenCalledWith(
      { staffId: AMBASSADOR.staffId, aal: "aal1" },
      { alertId: ALERT, targetId: TARGET },
      { entryId: ENTRY, text: "Water is off on floors 3 to 4.", phase: "problem", validUntil: new Date(NOW.getTime() + 24 * 3600_000), validUntilMode: "resolved" },
    );
    expect(d.submit).toHaveBeenCalledWith({ staffId: AMBASSADOR.staffId, aal: "aal1" }, { alertId: ALERT, entryId: ENTRY }, KEY, expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(d.withdrawEntry).not.toHaveBeenCalled();
    expect(d.startFinal).not.toHaveBeenCalled();
  });

  it("withdraws with the catalog's words for the reason and the ambassador's added after them, and for Other with their words alone", async () => {
    const d = deps();
    await followAndSubmit(d.wired, AMBASSADOR, withdraw);
    expect(d.withdrawEntry).toHaveBeenCalledWith(expect.anything(), { alertId: ALERT, targetId: TARGET }, { entryId: ENTRY, reason: "wrong_place", text: "This alert named the wrong place. It has been withdrawn. It was the next building." });
    const other = deps();
    await followAndSubmit(other.wired, AMBASSADOR, { ...withdraw, reason: "other", text: "The elevator is working again." });
    expect(other.withdrawEntry).toHaveBeenCalledWith(expect.anything(), expect.anything(), { entryId: ENTRY, reason: "other", text: "The elevator is working again." });
    // A reason that is not in the catalog goes to the use case as it came, which refuses it.
    const unknown = deps();
    await followAndSubmit(unknown.wired, AMBASSADOR, { ...withdraw, reason: "boring", text: "" });
    expect(unknown.withdrawEntry).toHaveBeenCalledWith(expect.anything(), expect.anything(), { entryId: ENTRY, reason: "boring", text: "" });
  });

  it("marks resolved by writing the final message, which only the Hub's approval turns into the alert closing", async () => {
    const d = deps();
    await followAndSubmit(d.wired, AMBASSADOR, resolve);
    expect(d.startFinal).toHaveBeenCalledWith(expect.anything(), { alertId: ALERT }, { entryId: ENTRY, text: "Water is back on." });
    expect(d.submit).toHaveBeenCalledTimes(1);
  });

  it("hands the submit's report to what follows a commit, so a correction that went on the web expires the feed", async () => {
    const report = { state: "committed", key: KEY, outcome: null, webPublished: true };
    const d = deps(report);
    await followAndSubmit(d.wired, AMBASSADOR, correct);
    expect(d.afterSubmit).toHaveBeenCalledWith(report);
  });

  it("answers a refusal of the use case as a refused body with its code, and submits nothing", async () => {
    const d = deps();
    d.correctEntry.mockResolvedValueOnce({ ok: false, error: "OUT_OF_SCOPE" } as never);
    expect(await followAndSubmit(d.wired, AMBASSADOR, correct)).toEqual({ v: 1, state: "refused", outcome: "OUT_OF_SCOPE", entry_state: null });
    expect(d.submit).not.toHaveBeenCalled();
    expect(d.afterSubmit).not.toHaveBeenCalled();
  });

  it("refuses a valid-until that cannot be read before any entry is made", async () => {
    const d = deps();
    expect(await followAndSubmit(d.wired, AMBASSADOR, { ...correct, valid: { mode: "at", date: "not a date", time: "" } })).toMatchObject({ state: "refused", outcome: "VALID_UNTIL_INVALID" });
    expect(d.correctEntry).not.toHaveBeenCalled();
  });

  it("is for an Ambassador only: any other role is refused NOT_ALLOWED and nothing is made", async () => {
    for (const role of ["coordinator", "admin", "director"] as const) {
      for (const body of [correct, withdraw, resolve]) {
        const d = deps();
        expect(await followAndSubmit(d.wired, { ...AMBASSADOR, role }, body)).toEqual({ v: 1, state: "refused", outcome: "NOT_ALLOWED", entry_state: null });
        expect(d.correctEntry).not.toHaveBeenCalled();
        expect(d.withdrawEntry).not.toHaveBeenCalled();
        expect(d.startFinal).not.toHaveBeenCalled();
        expect(d.submit).not.toHaveBeenCalled();
      }
    }
  });
});

describe("the follow-up's wire contract", () => {
  it("accepts each of the three requests and nothing with a field it does not know, a missing key or a text that is not a string", () => {
    for (const body of [correct, withdraw, resolve]) expect(AmbassadorFollowRequestSchema.safeParse(body).success).toBe(true);
    expect(AmbassadorFollowRequestSchema.safeParse({ ...resolve, extra: 1 }).success).toBe(false);
    expect(AmbassadorFollowRequestSchema.safeParse({ ...resolve, key: "short" }).success).toBe(false);
    expect(AmbassadorFollowRequestSchema.safeParse({ ...resolve, text: 5 }).success).toBe(false);
    expect(AmbassadorFollowRequestSchema.safeParse({ ...correct, target: "not-a-uuid" }).success).toBe(false);
    expect(AmbassadorFollowRequestSchema.safeParse({ ...resolve, action: "delete" }).success).toBe(false);
    // A final names no target: it is the alert's.
    expect(AmbassadorFollowRequestSchema.safeParse({ ...resolve, target: TARGET }).success).toBe(false);
  });
});
