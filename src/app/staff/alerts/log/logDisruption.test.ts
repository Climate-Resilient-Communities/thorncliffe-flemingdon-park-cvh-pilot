import { describe, expect, it, vi } from "vitest";
import type { AlertRefusal, LogDisruptionInput } from "@/modules/alerting";
import type { BuildingFloorPlan } from "@/modules/places";
import { BUILDING_TYPES, NEIGHBOURHOOD_TYPES, logDisruptionFromForm, logRefusalMessage, type LogDeps } from "./logDisruption";

const THREAD = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const session = { staffId: "01900000-0000-7000-8000-0000000000c1", aal: "aal2" as const };

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};

const PLAN = {
  rsn: "7001",
  address: "45 Thorncliffe Park Dr",
  neighbourhoodId: "TP",
  neighbourhoodName: "Thorncliffe Park",
  floors: [],
} as unknown as BuildingFloorPlan;

function deps(result: { ok: true } | { ok: false; error: AlertRefusal } = { ok: true }) {
  const logDisruption = vi.fn<(actor: unknown, input: LogDisruptionInput) => Promise<unknown>>(async () =>
    result.ok ? { ok: true as const, value: { thread: { id: THREAD }, entry: { id: ENTRY } } } : { ok: false as const, error: result.error },
  );
  const wired = { alerting: () => ({ logDisruption }) as unknown as ReturnType<LogDeps["alerting"]>, plans: async () => [PLAN], now: () => new Date("2026-10-04T14:00:00.000Z") } satisfies LogDeps;
  return { logDisruption, wired };
}

const valid: Array<[string, string]> = [
  ["kind", "ack"],
  ["type", "elevator"],
  ["scope", "buildings"],
  ["building", "7001"],
  ["floors-7001", "all"],
  ["reported-date", "2026-10-04"],
  ["reported-time", "09:30"],
];

describe("the types O-11 lists", () => {
  it("are the building types and then the neighbourhood-wide ones, none twice", () => {
    expect(NEIGHBOURHOOD_TYPES).toEqual(["heat", "smoke", "winter"]);
    expect(new Set([...BUILDING_TYPES, ...NEIGHBOURHOOD_TYPES]).size).toBe(BUILDING_TYPES.length + NEIGHBOURHOOD_TYPES.length);
  });
});

describe("logging a disruption from the form", () => {
  it("passes the types, the place, the Toronto time as an instant and the suggested text for the place to the use case, and goes on to the acknowledgement composer", async () => {
    const { logDisruption, wired } = deps();
    const state = await logDisruptionFromForm(wired, session, form(valid));

    expect(state).toEqual({ status: "logged", location: `/staff/alerts/ack?alert=${THREAD}&entry=${ENTRY}` });
    expect(logDisruption).toHaveBeenCalledTimes(1);
    const [actor, input] = logDisruption.mock.calls[0];
    expect(actor).toEqual(session);
    expect(input).toMatchObject({
      kind: "ack",
      isDrill: false,
      reportedAt: new Date("2026-10-04T13:30:00.000Z"),
      types: ["elevator"],
      place: { scope: "buildings", buildings: [{ rsn: "7001", floors: null }] },
    });
    // The text is made from the audience the use case worked out.
    const text = input.textFor({ scope: "buildings", buildings: [{ rsn: "7001", floors: null }], groups: [], types: ["elevator"] } as never);
    expect(text).toContain("45 Thorncliffe Park Dr");
    expect(text.length).toBeGreaterThan(20);
  });

  it("goes on to the alert composer for an update", async () => {
    const { wired } = deps();
    const state = await logDisruptionFromForm(wired, session, form(valid.map(([name, value]): [string, string] => (name === "kind" ? [name, "update"] : [name, value]))));
    expect(state).toEqual({ status: "logged", location: `/staff/alerts/compose?alert=${THREAD}&entry=${ENTRY}` });
  });

  it("reads each type once, however many times it was sent", async () => {
    const { logDisruption, wired } = deps();
    await logDisruptionFromForm(wired, session, form([...valid, ["type", "power"], ["type", "elevator"], ["type", ""]]));
    expect(logDisruption.mock.calls[0][1].types).toEqual(["elevator", "power"]);
  });

  it("makes nothing for a kind that is not one of the two, or no type, or no place, or no time", async () => {
    const { logDisruption, wired } = deps();
    const without = (name: string) => valid.filter(([field]) => field !== name && !field.startsWith(`${name}-`));
    for (const entries of [
      valid.map(([name, value]): [string, string] => (name === "kind" ? [name, "correct"] : [name, value])),
      without("kind"),
      without("type"),
      without("scope"),
      without("reported"),
      [...without("reported"), ["reported-date", "2026-10-04"], ["reported-time", ""]] as Array<[string, string]>,
    ]) {
      const state = await logDisruptionFromForm(wired, session, form(entries));
      expect(state.status, JSON.stringify(entries)).toBe("refused");
    }
    expect(logDisruption).not.toHaveBeenCalled();
  });

  it("refuses a type the screen never lists, with the reason, and makes nothing (a crafted request is not a server error)", async () => {
    const { logDisruption, wired } = deps();
    const state = await logDisruptionFromForm(wired, session, form([...valid.filter(([name]) => name !== "type"), ["type", "nonsense"]]));

    expect(state).toEqual({ status: "refused", message: logRefusalMessage("UNKNOWN_TYPE") });
    expect(logDisruption).not.toHaveBeenCalled();
    // Every type the screen lists is still taken.
    for (const type of [...BUILDING_TYPES, ...NEIGHBOURHOOD_TYPES]) {
      expect((await logDisruptionFromForm(wired, session, form([...valid.filter(([name]) => name !== "type"), ["type", type]]))).status, type).toBe("logged");
    }
  });

  it("says to choose a type when none is chosen", async () => {
    const { wired } = deps();
    expect(await logDisruptionFromForm(wired, session, form(valid.filter(([name]) => name !== "type")))).toEqual({
      status: "refused",
      message: expect.stringMatching(/type|choose/i),
    });
  });

  it("says the time does not exist when the clocks skip it, and asks before or after when they repeat it, making nothing either way", async () => {
    const { logDisruption, wired } = deps();
    const at = (date: string, time: string, extra: Array<[string, string]> = []) => [...valid.filter(([name]) => !name.startsWith("reported")), ["reported-date", date], ["reported-time", time], ...extra] as Array<[string, string]>;

    const skipped = await logDisruptionFromForm(wired, session, form(at("2026-03-08", "02:30")));
    expect(skipped).toEqual({ status: "refused", message: expect.stringContaining("does not exist in Toronto") });

    const repeated = await logDisruptionFromForm({ ...wired, now: () => new Date("2026-11-01T12:00:00.000Z") }, session, form(at("2026-11-01", "01:30")));
    expect(repeated).toMatchObject({ status: "ask", question: expect.stringContaining("happens twice"), before: expect.stringContaining("EDT"), after: expect.stringContaining("EST") });
    expect(logDisruption).not.toHaveBeenCalled();

    const answered = await logDisruptionFromForm(wired, session, form(at("2026-11-01", "01:30", [["reported-fold", "after"]])));
    expect(answered.status).toBe("logged");
    expect(logDisruption.mock.calls[0][1].reportedAt).toEqual(new Date("2026-11-01T06:30:00.000Z"));
  });

  it("tells the person what the use case refused, in the screen's words where it has them", async () => {
    const future = deps({ ok: false, error: "REPORTED_AT_INVALID" });
    expect(await logDisruptionFromForm(future.wired, session, form(valid))).toEqual({ status: "refused", message: logRefusalMessage("REPORTED_AT_INVALID") });
    expect(logRefusalMessage("REPORTED_AT_INVALID")).toMatch(/future|later|now/i);
    expect(logRefusalMessage("TYPES_EMPTY")).not.toBe(logRefusalMessage("UNKNOWN_TYPE"));
    // A refusal the screen has no words for is the place picker's, which has a catch-all.
    expect(logRefusalMessage("NO_SUCH_THING" as AlertRefusal).length).toBeGreaterThan(0);
  });
});
