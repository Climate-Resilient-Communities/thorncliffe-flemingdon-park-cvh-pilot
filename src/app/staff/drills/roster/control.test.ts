import { describe, expect, it, vi } from "vitest";
import type { DrillRoster, DrillRosterAddOutcome, DrillRosterEditOutcome, DrillRosterRemoveOutcome } from "@/modules/subscriptions";
import { addFromForm, editFromForm, removeFromForm, type ControlDeps } from "./control";

const ADMIN = { staffId: "01900000-0000-7000-8000-0000000000a1" };
const MEMBER = "01900000-0000-7000-8000-0000000000b1";
const NUMBER = "416-555-0123";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

function world(options: { add?: DrillRosterAddOutcome | Error; edit?: DrillRosterEditOutcome | Error; remove?: DrillRosterRemoveOutcome | Error } = {}) {
  const logged: { event: string; fields: Record<string, string> }[] = [];
  const roster = {
    list: vi.fn(),
    labelsOf: vi.fn(),
    size: vi.fn(),
    add: vi.fn(async () => {
      if (options.add instanceof Error) throw options.add;
      return options.add ?? { kind: "added" as const, id: MEMBER, label: "Hub phone", size: 1 };
    }),
    edit: vi.fn(async () => {
      if (options.edit instanceof Error) throw options.edit;
      return options.edit ?? { kind: "edited" as const, label: "Hub phone", size: 1 };
    }),
    remove: vi.fn(async () => {
      if (options.remove instanceof Error) throw options.remove;
      return options.remove ?? { kind: "removed" as const, label: "Hub phone", size: 0, skippedTexts: 0 };
    }),
  } satisfies DrillRoster;
  const deps: ControlDeps = { roster: () => roster, logError: (event, fields) => void logged.push({ event, fields }) };
  return { deps, logged, roster };
}

describe("pressing 'Add phone'", () => {
  it("adds as the signed-in Admin with the label, number and language from the form, and says who was added and how many are on the roster, without the number", async () => {
    const w = world({ add: { kind: "added", id: MEMBER, label: "Hub phone", size: 2 } });

    const answer = await addFromForm(w.deps, ADMIN, form({ label: "Hub phone", number: NUMBER, lang: "ur" }));

    expect(w.roster.add).toHaveBeenCalledWith({ actorStaffId: ADMIN.staffId, label: "Hub phone", number: NUMBER, lang: "ur" });
    expect(answer).toEqual({ status: "done", lines: ["Hub phone was added. The roster now has 2 phones."] });
    expect(JSON.stringify(answer)).not.toContain("555");
  });

  it("says the roster now has 1 phone in the singular", async () => {
    expect(await addFromForm(world().deps, ADMIN, form({ label: "Hub phone", number: NUMBER, lang: "en" }))).toEqual({ status: "done", lines: ["Hub phone was added. The roster now has 1 phone."] });
  });

  it.each([
    ["label_missing", "Give the phone a name or role."],
    ["label_too_long", "The name or role can have at most 40 characters."],
    ["number_invalid", "That is not a Canadian mobile number. Use ten digits, for example 416-555-0123."],
    ["number_duplicate", "That number is already on the roster."],
    ["language_invalid", "Choose a language from the list."],
    ["roster_full", "The roster is full: at most 20 phones. Remove one first."],
  ] as const)("turns the refusal %s into words and changes nothing", async (problem, message) => {
    expect(await addFromForm(world({ add: { kind: "refused", problem } }).deps, ADMIN, form({ label: "x", number: NUMBER, lang: "en" }))).toEqual({ status: "refused", message });
  });

  it("passes a missing field on as it is and lets the use case refuse it", async () => {
    const w = world({ add: { kind: "refused", problem: "label_missing" } });
    await addFromForm(w.deps, ADMIN, form({}));
    expect(w.roster.add).toHaveBeenCalledWith({ actorStaffId: ADMIN.staffId, label: null, number: null, lang: null });
  });

  it("says the roster was not changed when the use case fails, and logs the error's name only (never the number or the message)", async () => {
    const w = world({ add: new TypeError(`insert failed for ${NUMBER}`) });
    expect(await addFromForm(w.deps, ADMIN, form({ label: "Hub phone", number: NUMBER, lang: "en" }))).toEqual({
      status: "refused",
      message: "The roster was not changed. Try again. If it fails again, tell IT.",
    });
    expect(w.logged).toEqual([{ event: "drill_roster.add_failed", fields: { error: "TypeError" } }]);
    expect(JSON.stringify(w.logged)).not.toContain("555");
  });
});

describe("pressing 'Save changes'", () => {
  it("changes the member the form names, with what the form holds (an empty number keeps theirs), and says so", async () => {
    const w = world({ edit: { kind: "edited", label: "Priya", size: 3 } });
    const answer = await editFromForm(w.deps, ADMIN, form({ id: MEMBER, label: "Priya", number: "", lang: "hi" }));
    expect(w.roster.edit).toHaveBeenCalledWith({ actorStaffId: ADMIN.staffId, id: MEMBER, label: "Priya", number: "", lang: "hi" });
    expect(answer).toEqual({ status: "done", lines: ["Priya was changed."] });
  });

  it("says a refusal in words, and a member who is no longer on the roster is gone", async () => {
    expect(await editFromForm(world({ edit: { kind: "refused", problem: "number_duplicate" } }).deps, ADMIN, form({ id: MEMBER }))).toEqual({ status: "refused", message: "That number is already on the roster." });
    expect(await editFromForm(world({ edit: { kind: "refused", problem: "not_found" } }).deps, ADMIN, form({ id: MEMBER }))).toEqual({
      status: "refused",
      message: "That phone is no longer on the roster. Reload the page.",
    });
  });

  it("says the roster was not changed when the use case fails, and logs the error's name only", async () => {
    const w = world({ edit: new Error(`deadlock for ${NUMBER}`) });
    expect(await editFromForm(w.deps, ADMIN, form({ id: MEMBER, number: NUMBER }))).toEqual({ status: "refused", message: "The roster was not changed. Try again. If it fails again, tell IT." });
    expect(w.logged).toEqual([{ event: "drill_roster.edit_failed", fields: { error: "Error" } }]);
  });
});

describe("pressing 'Remove'", () => {
  it("removes the member the form names, and says so", async () => {
    const w = world({ remove: { kind: "removed", label: "Hub phone", size: 1, skippedTexts: 0 } });
    expect(await removeFromForm(w.deps, ADMIN, form({ id: MEMBER }))).toEqual({ status: "done", lines: ["Hub phone was removed. The roster now has 1 phone."] });
    expect(w.roster.remove).toHaveBeenCalledWith({ actorStaffId: ADMIN.staffId, id: MEMBER });
  });

  it("says the roster is empty after the last one, and how many waiting drill texts to that phone were cancelled", async () => {
    expect(await removeFromForm(world({ remove: { kind: "removed", label: "Hub phone", size: 0, skippedTexts: 3 } }).deps, ADMIN, form({ id: MEMBER }))).toEqual({
      status: "done",
      lines: ["Hub phone was removed. The roster is now empty.", "3 waiting drill texts to that phone were cancelled."],
    });
    expect(await removeFromForm(world({ remove: { kind: "removed", label: "Hub phone", size: 2, skippedTexts: 1 } }).deps, ADMIN, form({ id: MEMBER }))).toEqual({
      status: "done",
      lines: ["Hub phone was removed. The roster now has 2 phones.", "1 waiting drill text to that phone was cancelled."],
    });
  });

  it("says a phone that is no longer on the roster is gone, and a failure changed nothing", async () => {
    expect(await removeFromForm(world({ remove: { kind: "refused", problem: "not_found" } }).deps, ADMIN, form({ id: MEMBER }))).toEqual({
      status: "refused",
      message: "That phone is no longer on the roster. Reload the page.",
    });
    const w = world({ remove: new Error("deadlock detected") });
    expect(await removeFromForm(w.deps, ADMIN, form({ id: MEMBER }))).toEqual({ status: "refused", message: "The roster was not changed. Try again. If it fails again, tell IT." });
    expect(w.logged).toEqual([{ event: "drill_roster.remove_failed", fields: { error: "Error" } }]);
  });
});
