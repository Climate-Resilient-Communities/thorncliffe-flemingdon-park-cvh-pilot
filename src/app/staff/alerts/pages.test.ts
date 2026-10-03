import { describe, expect, it } from "vitest";
import { ACK_PAGE, COMPOSE_PAGE, PROMOTE_PAGE, UPDATE_PAGE, composerHref, composerOf, composerPage, isComposerFrom, updateHref } from "./pages";

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

describe("the addresses of the composers", () => {
  it("are four pages, each its own, and only those four are composers", () => {
    expect([ACK_PAGE, COMPOSE_PAGE, UPDATE_PAGE, PROMOTE_PAGE]).toEqual(["/staff/alerts/ack", "/staff/alerts/compose", "/staff/alerts/update", "/staff/alerts/promote"]);
    for (const from of ["ack", "compose", "update", "promote"]) expect(isComposerFrom(from)).toBe(true);
    for (const value of ["approve", "", null, undefined, 3, "toString", "__proto__", "constructor"]) expect(isComposerFrom(value), String(value)).toBe(false);
    expect(composerPage("promote")).toBe(PROMOTE_PAGE);
  });

  it("open a draft on its composer, and the start of an update on the page that fits the thread", () => {
    expect(composerHref("update", { alertId: ALERT, entryId: ENTRY })).toBe(`/staff/alerts/update?alert=${ALERT}&entry=${ENTRY}`);
    expect(updateHref(ALERT, false)).toBe(`/staff/alerts/update?alert=${ALERT}`);
    expect(updateHref(ALERT, true)).toBe(`/staff/alerts/promote?alert=${ALERT}`);
  });
});
