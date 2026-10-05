import { describe, expect, it, vi } from "vitest";
import type { SetCapOutcome, SpendCapService } from "@/modules/spend";
import { setCapFromForm, type ControlDeps } from "./control";

const ADMIN = { staffId: "01900000-0000-7000-8000-0000000000a1" };

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

function world(result: SetCapOutcome | Error) {
  const logged: { event: string; fields: Record<string, string> }[] = [];
  const cap = {
    read: vi.fn(),
    set: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  } satisfies SpendCapService;
  const deps: ControlDeps = { cap: () => cap, logError: (event, fields) => void logged.push({ event, fields }) };
  return { deps, cap, logged };
}

describe("pressing 'Save cap'", () => {
  it("sets the cap as the signed-in Admin with the amount from the form, and says what it is now", async () => {
    const w = world({ kind: "set", capCents: 25_050, previousCents: null });
    const answer = await setCapFromForm(w.deps, ADMIN, form({ cap: "250.50" }));
    expect(w.cap.set).toHaveBeenCalledWith({ actorStaffId: ADMIN.staffId, amount: "250.50" });
    expect(answer).toEqual({ status: "done", lines: ["The monthly cap is now CAD 250.50."] });
  });

  it("says what a change was from and to", async () => {
    const answer = await setCapFromForm(world({ kind: "set", capCents: 30_000, previousCents: 25_050 }).deps, ADMIN, form({ cap: "300" }));
    expect(answer).toEqual({ status: "done", lines: ["The monthly cap changed from CAD 250.50 to CAD 300.00."] });
  });

  it.each([
    ["missing", "Type the monthly cap in dollars."],
    ["not_a_number", "That is not an amount. Use dollars, for example 250 or 250.50."],
    ["too_small", "The cap must be at least $0.01."],
    ["too_large", "The cap can be at most $100,000."],
  ] as const)("turns the refusal %s into words and changes nothing", async (problem, message) => {
    const answer = await setCapFromForm(world({ kind: "refused", problem }).deps, ADMIN, form({ cap: "x" }));
    expect(answer).toEqual({ status: "refused", message });
  });

  it("leaves the cap as it was and says so when the change fails, logging only the error's name", async () => {
    const w = world(new TypeError("the database refused cap 25000"));
    const answer = await setCapFromForm(w.deps, ADMIN, form({ cap: "250" }));
    expect(answer).toEqual({ status: "refused", message: "The cap was not changed. Try again. If it fails again, tell IT." });
    expect(w.logged).toEqual([{ event: "spend.cap_set_failed", fields: { error: "TypeError" } }]);
  });

  it("passes a form with no amount on as a missing one", async () => {
    const w = world({ kind: "refused", problem: "missing" });
    await setCapFromForm(w.deps, ADMIN, form({}));
    expect(w.cap.set).toHaveBeenCalledWith({ actorStaffId: ADMIN.staffId, amount: null });
  });
});
