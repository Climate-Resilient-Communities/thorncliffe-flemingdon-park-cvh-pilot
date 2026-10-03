import { describe, expect, it } from "vitest";
import { ACK_PAGE, COMPOSE_PAGE, CORRECT_PAGE, PROMOTE_PAGE, RESOLVE_PAGE, UPDATE_PAGE, WITHDRAW_PAGE, composerHref, composerOf, composerPage, correctHref, isComposerFrom, resolveHref, updateHref, withdrawHref } from "./pages";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";

describe("which composer an entry is written on (S05.01)", () => {
  it("is the acknowledgement composer for an acknowledgement, whatever came before", () => {
    expect(composerOf("ack")).toBe("ack");
    expect(composerOf("ack", ["ack"])).toBe("ack");
  });

  it("is the alert composer for a thread's first entry when it is an update (a full alert written without an acknowledgement)", () => {
    expect(composerOf("update")).toBe("compose");
    expect(composerOf("update", [])).toBe("compose");
  });

  it('is "Promote to full alert" for an update that follows nothing but acknowledgements: it is the first update', () => {
    expect(composerOf("update", ["ack"])).toBe("promote");
    expect(composerOf("update", ["ack", "ack"])).toBe("promote");
  });

  it('is "Add an update" once an update, a correction or a full alert came before', () => {
    expect(composerOf("update", ["ack", "update"])).toBe("update");
    expect(composerOf("update", ["update"])).toBe("update");
    expect(composerOf("update", ["ack", "correction"])).toBe("update");
  });
});

describe("which composer a correction or a withdrawal is written on (S05.02)", () => {
  it("is its own page, whatever came before it", () => {
    expect(composerOf("correction")).toBe("correct");
    expect(composerOf("correction", ["ack", "update"])).toBe("correct");
    expect(composerOf("withdrawal")).toBe("withdraw");
    expect(composerOf("withdrawal", ["ack"])).toBe("withdraw");
  });
});

describe("which composer a final is written on (S05.03)", () => {
  it("is its own page, whatever came before it", () => {
    expect(composerOf("final")).toBe("resolve");
    expect(composerOf("final", ["ack", "update"])).toBe("resolve");
    expect(RESOLVE_PAGE).toBe("/staff/alerts/resolve");
    expect(isComposerFrom("resolve")).toBe(true);
    expect(composerPage("resolve")).toBe(RESOLVE_PAGE);
    expect(resolveHref(ALERT)).toBe(`/staff/alerts/resolve?alert=${ALERT}`);
  });
});

describe("the addresses of the composers", () => {
  it("are seven pages, each its own, and only those seven are composers", () => {
    expect([ACK_PAGE, COMPOSE_PAGE, UPDATE_PAGE, PROMOTE_PAGE, CORRECT_PAGE, WITHDRAW_PAGE, RESOLVE_PAGE]).toEqual([
      "/staff/alerts/ack",
      "/staff/alerts/compose",
      "/staff/alerts/update",
      "/staff/alerts/promote",
      "/staff/alerts/correct",
      "/staff/alerts/withdraw",
      "/staff/alerts/resolve",
    ]);
    for (const from of ["ack", "compose", "update", "promote", "correct", "withdraw", "resolve"]) expect(isComposerFrom(from)).toBe(true);
    for (const value of ["approve", "", null, undefined, 3, "toString", "__proto__", "constructor"]) expect(isComposerFrom(value), String(value)).toBe(false);
    expect(composerPage("promote")).toBe(PROMOTE_PAGE);
  });

  it("open a draft on its composer, and the start of an update on the page that fits the thread", () => {
    expect(composerHref("update", { alertId: ALERT, entryId: ENTRY })).toBe(`/staff/alerts/update?alert=${ALERT}&entry=${ENTRY}`);
    expect(updateHref(ALERT, false)).toBe(`/staff/alerts/update?alert=${ALERT}`);
    expect(updateHref(ALERT, true)).toBe(`/staff/alerts/promote?alert=${ALERT}`);
  });

  it("open the start of a correction or a withdrawal, with the entry chosen when there is one", () => {
    expect(correctHref(ALERT)).toBe(`/staff/alerts/correct?alert=${ALERT}`);
    expect(correctHref(ALERT, ENTRY)).toBe(`/staff/alerts/correct?alert=${ALERT}&target=${ENTRY}`);
    expect(withdrawHref(ALERT)).toBe(`/staff/alerts/withdraw?alert=${ALERT}`);
    expect(withdrawHref(ALERT, ENTRY)).toBe(`/staff/alerts/withdraw?alert=${ALERT}&target=${ENTRY}`);
    expect(composerHref("withdraw", { alertId: ALERT, entryId: ENTRY })).toBe(`/staff/alerts/withdraw?alert=${ALERT}&entry=${ENTRY}`);
  });
});
