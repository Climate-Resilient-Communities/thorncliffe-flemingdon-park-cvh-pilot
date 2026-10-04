import { describe, expect, it, vi } from "vitest";
import type { AmbassadorPostRequest } from "@/contracts/ambassadorPost";
import { postAndSubmit, type PostDeps } from "./postRequest";

const ID = "01900000-0000-7000-8000-000000000001";
const ENTRY = "01900000-0000-7000-8000-000000000002";
const FLOOR = "01900000-0000-7000-8000-415444600001";
const NOW = new Date("2026-10-04T15:00:00.000Z");
const SESSION = { staffId: "01900000-0000-7000-8000-0000000000c1", aal: "aal1" as const };

const body: AmbassadorPostRequest = {
  v: 1,
  into: null,
  alert_id: ID,
  entry_id: ENTRY,
  key: "k".repeat(32),
  rsn: "4154446",
  floors: { mode: "list", ids: [FLOOR] },
  types: ["power"],
  phase: "problem",
  valid: { mode: "resolved" },
  text: "The power is out.",
};

function deps(report: unknown) {
  const afterSubmit = vi.fn();
  const submit = vi.fn(async () => report);
  const wired = {
    alerting: () => ({
      postFromAmbassador: vi.fn(async () => ({
        ok: true,
        value: { thread: { id: ID }, entry: { id: ENTRY, status: "draft", content: { text: "The power is out.", types: ["power"], audience: { scope: "buildings", buildings: [], groups: [], types: ["power"] }, phase: "problem", validUntil: NOW, validUntilMode: "resolved" } } },
      })),
    }),
    submitter: () => ({ submit, state: vi.fn(async () => null) }),
    now: () => NOW,
    afterSubmit,
  } as unknown as PostDeps;
  return { wired, afterSubmit, submit };
}

describe("an ambassador's post after the submit commits (S08.03)", () => {
  it("hands the submit's report to what follows a commit, so a post that went on the web expires the feed", async () => {
    const report = { state: "committed", key: body.key, outcome: null, webPublished: true };
    const d = deps(report);
    const result = await postAndSubmit(d.wired, SESSION, body);
    expect(result).toMatchObject({ state: "committed" });
    expect(d.afterSubmit).toHaveBeenCalledTimes(1);
    expect(d.afterSubmit).toHaveBeenCalledWith(report);
  });

  it("does not call it for a post that was refused before anything was submitted", async () => {
    const d = deps({ state: "committed", key: body.key, outcome: null });
    const result = await postAndSubmit(d.wired, SESSION, { ...body, valid: { mode: "at", date: "not a date", time: "" } });
    expect(result).toMatchObject({ state: "refused", outcome: "VALID_UNTIL_INVALID" });
    expect(d.submit).not.toHaveBeenCalled();
    expect(d.afterSubmit).not.toHaveBeenCalled();
  });
});
