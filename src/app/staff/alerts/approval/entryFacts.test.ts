import { describe, expect, it, vi } from "vitest";
import { can } from "@/modules/identity";
import type { EntryView } from "@/modules/alerting";
import { ALERT, APPROVER, AUTHOR, ENTRY } from "../../../../../test/helpers/approvalReview";
import { approvalFacts } from "./entryFacts";

const entryOf = (over: Partial<EntryView> = {}) => ({ id: ENTRY, alertId: ALERT, authorId: AUTHOR, editorIds: [AUTHOR], status: "pending_approval", ...over }) as unknown as EntryView;
const reader = (entry: EntryView | null) => ({ getEntry: vi.fn(async () => entry) });

describe("the facts the approval's guard judges on", () => {
  it("are the entry's author, editors and status as the database holds them, for the policy's 'not an editor' rule", async () => {
    const alerting = reader(entryOf({ editorIds: [AUTHOR, "01900000-0000-7000-8000-0000000000c3"] }));
    const facts = await approvalFacts(alerting, { alertId: ALERT, entryId: ENTRY });
    expect(alerting.getEntry).toHaveBeenCalledWith({ alertId: ALERT, entryId: ENTRY });
    expect(facts).toEqual({ entry: { authorId: AUTHOR, editorIds: [AUTHOR, "01900000-0000-7000-8000-0000000000c3"], status: "pending_approval" } });
    expect(can("coordinator", "alert.approve", { actorId: APPROVER, ...facts })).toBe(true);
    expect(can("coordinator", "alert.approve", { actorId: AUTHOR, ...facts })).toBe(false);
    expect(can("admin", "alert.approve", { actorId: "01900000-0000-7000-8000-0000000000c3", ...facts })).toBe(false);
  });

  it("refuse an editor who is not the author, and let anyone else of a role that approves through", async () => {
    const facts = await approvalFacts(reader(entryOf({ authorId: AUTHOR, editorIds: [AUTHOR, APPROVER] })), { alertId: ALERT, entryId: ENTRY });
    expect(can("coordinator", "alert.approve", { actorId: APPROVER, ...facts })).toBe(false);
    expect(can("director", "alert.approve", { actorId: "01900000-0000-7000-8000-0000000000c9", ...facts })).toBe(false);
    expect(can("ambassador", "alert.approve", { actorId: "01900000-0000-7000-8000-0000000000c9", ...facts })).toBe(false);
  });

  it("are neutral for an entry that is not there: nobody is excluded from it, so the page or the use case says 'not found', and a role that never approves is still refused", async () => {
    for (const ref of [{ alertId: ALERT, entryId: ENTRY }, { alertId: "", entryId: "" }]) {
      const facts = await approvalFacts(reader(null), ref);
      expect(can("coordinator", "alert.approve", { actorId: APPROVER, ...facts })).toBe(true);
      expect(can("admin", "alert.approve", { actorId: APPROVER, ...facts })).toBe(true);
      expect(can("director", "alert.approve", { actorId: APPROVER, ...facts })).toBe(false);
      expect(can("ambassador", "alert.approve", { actorId: APPROVER, ...facts })).toBe(false);
    }
  });
});
