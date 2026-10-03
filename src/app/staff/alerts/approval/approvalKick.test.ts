// What an approval starts once it has committed (S04.07 with S06.02 and S06.06): the sender is kicked exactly once, after the commit and never inside the
// transaction, never for a refusal or a rollback, whatever the pause says; and the segment that hosts the approval's actions exports `maxDuration = 60` as a
// literal, because the kick's run lives in that function after the response. The real `afterApproval` and the real `approveFromForm` run here; the use case
// is a fake that keeps the account of its own transaction, and `@/app/dispatch` is the fake kick seam.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeCounts, type RecipientCounts } from "@/contracts/alertApproval";
import type { ApprovalOutcome, EntryView } from "@/modules/alerting";
import { ALERT, ENTRY, HASH } from "../../../../../test/helpers/approvalReview";

const seam = vi.hoisted(() => ({ kickDispatcher: vi.fn() }));
vi.mock("@/app/dispatch", () => ({ kickDispatcher: seam.kickDispatcher }));
const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: cache.revalidateTag }));

import { pauseNoticeForApprover } from "../../pauseNotice";
import { afterApproval } from "./afterApproval";
import { approveFromForm, discardFromForm, returnFromForm, type ApprovalDeps } from "./approveFromForm";

const ROOT = path.join(__dirname, "..", "..", "..", "..", "..");
const APP = path.join(ROOT, "src", "app");
const session = { staffId: "01900000-0000-7000-8000-0000000000c2", aal: "aal2" as const };
const REVIEWED: RecipientCounts = { total: 3, byLanguage: { en: 2, ur: 1 } };

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};
const approveForm = () => form([["alert", ALERT], ["entry", ENTRY], ["version", "2"], ["hash", HASH], ["reviewed", encodeCounts(REVIEWED)]]);
const withNote = () => form([["alert", ALERT], ["entry", ENTRY], ["version", "2"], ["hash", HASH], ["note", "Say which floors."]]);

const outcome = (feedVersion: number | null = 8): ApprovalOutcome => ({ entry: { id: ENTRY, alertId: ALERT } as unknown as EntryView, recipients: REVIEWED, feedVersion });

/** Where the fake use case's own transaction is when something happens: the kick is asked where it stood when it was called. */
let transaction: "none" | "open" | "committed" | "rolled back" = "none";
const kickedWhile: string[] = [];

type Result = { ok: true; value: ApprovalOutcome } | { ok: false; error: string } | "throws";

function wired(approve: Result) {
  const approveEntry = vi.fn(async () => {
    transaction = "open";
    await Promise.resolve();
    if (approve === "throws") {
      transaction = "rolled back";
      throw new Error("deadlock detected");
    }
    transaction = approve.ok ? "committed" : "rolled back";
    return approve;
  });
  const done = async () => {
    transaction = "committed";
    return { ok: true as const, value: {} };
  };
  const returnEntry = vi.fn(done);
  const discardEntry = vi.fn(done);
  const refuseInvalidForm = vi.fn(async () => undefined);
  const review = vi.fn(async () => null);
  const deps: ApprovalDeps = {
    alerting: () => ({ approveEntry, returnEntry, discardEntry, refuseInvalidForm, review }) as unknown as ReturnType<ApprovalDeps["alerting"]>,
    // The real one, with its real defaults: the kick is the dispatcher's own seam (mocked above), the feed's tag is Next's (mocked above).
    afterApproval: (result) => afterApproval(result),
    pricePerSegmentCents: () => 1.5,
  };
  return { approveEntry, returnEntry, discardEntry, refuseInvalidForm, deps };
}

beforeEach(() => {
  transaction = "none";
  kickedWhile.length = 0;
  seam.kickDispatcher.mockReset();
  seam.kickDispatcher.mockImplementation(() => void kickedWhile.push(transaction));
  cache.revalidateTag.mockReset();
});

describe("the sender is kicked once an approval has committed (S06.02)", () => {
  it("calls kickDispatcher() once, with no argument, after the transaction committed and never inside it", async () => {
    const w = wired({ ok: true, value: outcome() });
    expect(await approveFromForm(w.deps, session, approveForm())).toMatchObject({ status: "done" });
    expect(seam.kickDispatcher).toHaveBeenCalledTimes(1);
    expect(seam.kickDispatcher).toHaveBeenCalledWith();
    expect(kickedWhile).toEqual(["committed"]);
    // And after the feed's tag was expired, which is the other thing a committed approval starts.
    expect(cache.revalidateTag).toHaveBeenCalledWith("feed", { expire: 0 });
  });

  it("kicks for a drill too, which raised no feed version and expires no tag, because its roster's texts are queued", async () => {
    const w = wired({ ok: true, value: outcome(null) });
    await approveFromForm(w.deps, session, approveForm());
    expect(seam.kickDispatcher).toHaveBeenCalledTimes(1);
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  it.each(["ENTRY_CHANGED", "VALID_UNTIL_PAST", "EDITOR_CANNOT_APPROVE", "AAL2_REQUIRED", "RECIPIENT_COUNT_CHANGED", "ENTRY_NOT_PENDING"])(
    "never kicks for an approval the use case refused with %s: it rolled back and nothing was queued",
    async (error) => {
      const w = wired({ ok: false, error });
      expect(await approveFromForm(w.deps, session, approveForm())).not.toMatchObject({ status: "done" });
      expect(transaction).toBe("rolled back");
      expect(seam.kickDispatcher).not.toHaveBeenCalled();
    },
  );

  it("never kicks for an approval whose transaction failed and rolled back", async () => {
    const w = wired("throws");
    await expect(approveFromForm(w.deps, session, approveForm())).rejects.toThrow(/deadlock/);
    expect(transaction).toBe("rolled back");
    expect(seam.kickDispatcher).not.toHaveBeenCalled();
  });

  it("never kicks for a form that did not carry what was shown: the use case is not even asked", async () => {
    const w = wired({ ok: true, value: outcome() });
    await approveFromForm(w.deps, session, form([["alert", ALERT], ["entry", ENTRY]]));
    expect(w.approveEntry).not.toHaveBeenCalled();
    expect(seam.kickDispatcher).not.toHaveBeenCalled();
  });

  it("never kicks for Return to author or Discard, which queue nothing", async () => {
    const w = wired({ ok: true, value: outcome() });
    await returnFromForm(w.deps, session, withNote());
    await discardFromForm(w.deps, session, withNote());
    expect(w.returnEntry).toHaveBeenCalledTimes(1);
    expect(w.discardEntry).toHaveBeenCalledTimes(1);
    expect(seam.kickDispatcher).not.toHaveBeenCalled();
  });

  it("does not turn a committed approval into a failure when the kick cannot be started: it is logged by name and the approval stays approved", async () => {
    seam.kickDispatcher.mockImplementation(() => {
      throw new RangeError("no lease");
    });
    const failure = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = wired({ ok: true, value: outcome() });
    expect(await approveFromForm(w.deps, session, approveForm())).toMatchObject({ status: "done" });
    expect(failure).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(failure.mock.calls[0][0]))).toEqual({ evt: "approval.after_commit_failed", module: "alerting", step: "kick_dispatcher", error: "RangeError" });
    failure.mockRestore();
  });
});

describe("the pause neither refuses nor changes an approval (S06.06)", () => {
  it("tells the approver while texts are paused, and the approval that follows is the same approval, which kicks the sender as ever", async () => {
    const paused = vi.fn(async () => true);
    expect(await pauseNoticeForApprover({ paused, logError: vi.fn() })).toBe("Texts are paused; this will send when resumed");
    paused.mockClear();

    const w = wired({ ok: true, value: outcome() });
    expect(await approveFromForm(w.deps, session, approveForm())).toEqual({ status: "done", location: `/staff/alerts/approve?alert=${ALERT}&entry=${ENTRY}` });
    // The approval never reads the switch: what it asked the use case and what it started afterwards do not depend on it.
    expect(paused).not.toHaveBeenCalled();
    expect(w.approveEntry).toHaveBeenCalledTimes(1);
    expect(seam.kickDispatcher).toHaveBeenCalledTimes(1);
    expect(kickedWhile).toEqual(["committed"]);
  });

  it("shows no notice when texts are going out, and when the switch cannot be read, and never lets that block anything", async () => {
    const logError = vi.fn();
    expect(await pauseNoticeForApprover({ paused: async () => false, logError })).toBeNull();
    expect(await pauseNoticeForApprover({ paused: async () => { throw new TypeError("connection reset"); }, logError })).toBeNull();
    expect(logError).toHaveBeenCalledWith("messaging.pause_notice_failed", { error: "TypeError" });
  });
});

describe("the segment that hosts the approval's actions", () => {
  const read = (file: string) => readFileSync(file, "utf8");
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(file);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
    });
  const relative = (file: string) => path.relative(ROOT, file);
  const PAGE = path.join(APP, "staff", "alerts", "approve", "page.tsx");

  it("exports maxDuration = 60 as a literal, which Next.js reads statically, once", () => {
    const source = read(PAGE);
    expect(source).toMatch(/^export const maxDuration = 60;$/m);
    expect(source.match(/export\s+(const|let|var|function)\s+maxDuration\b/g)).toHaveLength(1);
    expect(source).not.toMatch(/export\s*\{[^}]*maxDuration/);
  });

  it("is the only page that shows the approval's forms, so no other segment runs the kick: ApprovalPage is used here alone, and its actions are imported only by it", () => {
    const files = sources(APP);
    const importersOf = (pattern: RegExp) => files.filter((file) => pattern.test(read(file))).map(relative).sort();
    expect(importersOf(/import[^;]*\bApprovalPage\b[^;]*from\s+"[^"]*approval\/ApprovalPage"/)).toEqual([relative(PAGE)]);
    expect(importersOf(/from\s+"(?:\.\/actions|[^"]*alerts\/approval\/actions)"/).filter((file) => file.includes("alerts/approval/"))).toEqual(["src/app/staff/alerts/approval/ApprovalPage.tsx"]);
  });

  it("is where the approving action's use of afterApproval is wired, and afterApproval is what kicks", () => {
    expect(read(path.join(APP, "staff", "alerts", "approval", "actions.ts"))).toMatch(/afterApproval,/);
    expect(read(path.join(APP, "staff", "alerts", "approval", "afterApproval.ts"))).toMatch(/import\("@\/app\/dispatch"\)/);
  });
});
