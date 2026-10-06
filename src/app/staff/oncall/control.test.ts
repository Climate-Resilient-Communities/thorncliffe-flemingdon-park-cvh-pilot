import { describe, expect, it, vi } from "vitest";
import type { AddOutcome, OnDutyOutcome, OncallRoster, RemoveOutcome } from "@/modules/ops";
import { addFromForm, clearOnDutyFromForm, removeFromForm, setOnDutyFromForm, type ControlDeps } from "./control";

const ADMIN = { staffId: "01900000-0000-7000-8000-0000000000a1" };
const ENTRY = "01900000-0000-7000-8000-0000000000b1";
const NUMBER = "416-555-0123";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

function world(options: { add?: AddOutcome | Error; remove?: RemoveOutcome | Error; onDuty?: OnDutyOutcome | Error } = {}) {
  const calls: string[] = [];
  const logged: { event: string; fields: Record<string, string> }[] = [];
  const roster = {
    list: vi.fn(),
    hasNumber: vi.fn(),
    add: vi.fn(async (input: { actorStaffId: string; label: unknown; number: unknown }) => {
      calls.push(`add ${input.actorStaffId} ${JSON.stringify(input.label)}`);
      if (options.add instanceof Error) throw options.add;
      return options.add ?? { kind: "added" as const, id: ENTRY, label: "IT lead", size: 1 };
    }),
    remove: vi.fn(async (input: { actorStaffId: string; id: unknown }) => {
      calls.push(`remove ${input.actorStaffId} ${JSON.stringify(input.id)}`);
      if (options.remove instanceof Error) throw options.remove;
      return options.remove ?? { kind: "removed" as const, label: "IT lead", size: 0, skippedTexts: 0 };
    }),
    setOnDuty: vi.fn(async (input: { actorStaffId: string; id: unknown; staffId: unknown }) => {
      calls.push(`on duty ${input.actorStaffId} ${JSON.stringify(input.id)} ${JSON.stringify(input.staffId)}`);
      if (options.onDuty instanceof Error) throw options.onDuty;
      return options.onDuty ?? { kind: "set" as const, label: "IT lead" };
    }),
    clearOnDuty: vi.fn(async (input: { actorStaffId: string }) => {
      calls.push(`nobody on duty ${input.actorStaffId}`);
      if (options.onDuty instanceof Error) throw options.onDuty;
      return options.onDuty ?? { kind: "cleared" as const, label: "IT lead" };
    }),
    onDutyState: vi.fn(),
  } satisfies OncallRoster;
  const deps: ControlDeps = { roster: () => roster, logError: (event, fields) => void logged.push({ event, fields }) };
  return { deps, calls, logged, roster };
}

describe("pressing 'Add number'", () => {
  it("adds as the signed-in Admin with the label and number from the form, and says who was added and how many are on the list, without the number", async () => {
    const w = world({ add: { kind: "added", id: ENTRY, label: "IT lead", size: 2 } });

    const answer = await addFromForm(w.deps, ADMIN, form({ label: "IT lead", number: NUMBER }));

    expect(w.calls).toEqual([`add ${ADMIN.staffId} "IT lead"`]);
    expect(w.roster.add).toHaveBeenCalledWith({ actorStaffId: ADMIN.staffId, label: "IT lead", number: NUMBER });
    expect(answer).toEqual({ status: "done", lines: ["IT lead was added. The list now has 2 numbers."] });
    expect(JSON.stringify(answer)).not.toContain("555");
  });

  it("says the list now has 1 number in the singular", async () => {
    const answer = await addFromForm(world().deps, ADMIN, form({ label: "IT lead", number: NUMBER }));
    expect(answer).toEqual({ status: "done", lines: ["IT lead was added. The list now has 1 number."] });
  });

  it.each([
    ["label_missing", "Give the number a name or role."],
    ["label_too_long", "The name or role can have at most 40 characters."],
    ["number_invalid", "That is not a Canadian mobile number. Use ten digits, for example 416-555-0123."],
    ["number_duplicate", "That number is already on the list."],
    ["roster_full", "The list is full: at most 10 numbers. Remove one first."],
  ] as const)("turns the refusal %s into words and changes nothing", async (problem, message) => {
    const answer = await addFromForm(world({ add: { kind: "refused", problem } }).deps, ADMIN, form({ label: "x", number: NUMBER }));
    expect(answer).toEqual({ status: "refused", message });
  });

  it("passes a missing field on as it is and lets the use case refuse it", async () => {
    const w = world({ add: { kind: "refused", problem: "label_missing" } });
    await addFromForm(w.deps, ADMIN, form({}));
    expect(w.roster.add).toHaveBeenCalledWith({ actorStaffId: ADMIN.staffId, label: null, number: null });
  });

  it("says the list was not changed when the use case fails, and logs the error's name only (never the number or the message)", async () => {
    const w = world({ add: new TypeError(`insert failed for ${NUMBER}`) });
    const answer = await addFromForm(w.deps, ADMIN, form({ label: "IT lead", number: NUMBER }));
    expect(answer).toEqual({ status: "refused", message: "The list was not changed. Try again. If it fails again, tell IT." });
    expect(w.logged).toEqual([{ event: "oncall.add_failed", fields: { error: "TypeError" } }]);
    expect(JSON.stringify(w.logged)).not.toContain("555");
  });
});

describe("pressing 'Remove'", () => {
  it("removes the entry the form names, and says so", async () => {
    const w = world({ remove: { kind: "removed", label: "IT lead", size: 1, skippedTexts: 0 } });
    const answer = await removeFromForm(w.deps, ADMIN, form({ id: ENTRY }));
    expect(w.calls).toEqual([`remove ${ADMIN.staffId} "${ENTRY}"`]);
    expect(answer).toEqual({ status: "done", lines: ["IT lead was removed. The list now has 1 number."] });
  });

  it("says the list is empty after the last one, and how many waiting texts to that number were cancelled", async () => {
    const answer = await removeFromForm(world({ remove: { kind: "removed", label: "IT lead", size: 0, skippedTexts: 3 } }).deps, ADMIN, form({ id: ENTRY }));
    expect(answer).toEqual({ status: "done", lines: ["IT lead was removed. The list is now empty.", "3 waiting texts to that number were cancelled."] });
    const one = await removeFromForm(world({ remove: { kind: "removed", label: "IT lead", size: 2, skippedTexts: 1 } }).deps, ADMIN, form({ id: ENTRY }));
    expect(one).toEqual({ status: "done", lines: ["IT lead was removed. The list now has 2 numbers.", "1 waiting text to that number was cancelled."] });
  });

  it("says an entry that is no longer on the list is gone", async () => {
    const answer = await removeFromForm(world({ remove: { kind: "refused", problem: "not_found" } }).deps, ADMIN, form({ id: ENTRY }));
    expect(answer).toEqual({ status: "refused", message: "That number is no longer on the list. Reload the page." });
  });

  it("says the list was not changed when the use case fails, and logs the error's name only", async () => {
    const w = world({ remove: new Error("deadlock detected") });
    expect(await removeFromForm(w.deps, ADMIN, form({ id: ENTRY }))).toEqual({ status: "refused", message: "The list was not changed. Try again. If it fails again, tell IT." });
    expect(w.logged).toEqual([{ event: "oncall.remove_failed", fields: { error: "Error" } }]);
  });
});

describe("the on-duty Admin (S08.08)", () => {
  const STAFF = "01900000-0000-7000-8000-0000000000c1";

  it("'Set on duty' sets the entry and Admin account the form names, as the signed-in Admin, and says who is on duty without the number", async () => {
    const w = world({ onDuty: { kind: "set", label: "IT lead" } });
    const answer = await setOnDutyFromForm(w.deps, ADMIN, form({ id: ENTRY, staff_id: STAFF }));
    expect(w.calls).toEqual([`on duty ${ADMIN.staffId} "${ENTRY}" "${STAFF}"`]);
    expect(answer).toEqual({ status: "done", lines: ["IT lead is now on duty."] });
  });

  it("turns a refusal into words: an account that is not an active Admin with an authenticator, an entry gone, nobody on duty", async () => {
    expect(await setOnDutyFromForm(world({ onDuty: { kind: "refused", problem: "not_admin" } }).deps, ADMIN, form({ id: ENTRY, staff_id: STAFF }))).toEqual({
      status: "refused",
      message: "That account is not an active Admin with an authenticator. Choose another.",
    });
    expect(await setOnDutyFromForm(world({ onDuty: { kind: "refused", problem: "not_found" } }).deps, ADMIN, form({ id: ENTRY, staff_id: STAFF }))).toEqual({
      status: "refused",
      message: "That number is no longer on the list. Reload the page.",
    });
    expect(await clearOnDutyFromForm(world({ onDuty: { kind: "refused", problem: "not_on_duty" } }).deps, ADMIN)).toEqual({ status: "refused", message: "Nobody is on duty. Reload the page." });
  });

  it("'Nobody on duty' ends it and says the number stays on the list", async () => {
    const w = world();
    expect(await clearOnDutyFromForm(w.deps, ADMIN)).toEqual({ status: "done", lines: ["Nobody is on duty now. IT lead stays on the list."] });
    expect(w.calls).toEqual([`nobody on duty ${ADMIN.staffId}`]);
  });

  it("says nothing changed when the use case fails, and logs the error's name only", async () => {
    const w = world({ onDuty: new RangeError("boom") });
    expect(await setOnDutyFromForm(w.deps, ADMIN, form({ id: ENTRY, staff_id: STAFF }))).toEqual({ status: "refused", message: "The list was not changed. Try again. If it fails again, tell IT." });
    expect(await clearOnDutyFromForm(w.deps, ADMIN)).toEqual({ status: "refused", message: "The list was not changed. Try again. If it fails again, tell IT." });
    expect(w.logged).toEqual([
      { event: "oncall.on_duty_failed", fields: { error: "RangeError" } },
      { event: "oncall.on_duty_failed", fields: { error: "RangeError" } },
    ]);
  });
});
