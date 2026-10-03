import { describe, expect, it } from "vitest";
import { DELIVERY_STATES, TERMINAL_STATES, TRANSITION_TABLE, UNRESOLVED_STATES, canStopBeforeHandOff, canTransition, isTerminal, type DeliveryState } from "./deliveryState";

/** The transition table of the E06 definitions, written out pair by pair (the code's table is checked against this list). */
const ALLOWED: readonly [DeliveryState, DeliveryState][] = [
  ["queued", "claimed"],
  ["queued", "cancelled"],
  ["queued", "skipped"],
  ["claimed", "queued"],
  ["claimed", "cancelled"],
  ["claimed", "skipped"],
  ["claimed", "skipped_env"],
  ["claimed", "submitted"],
  ["claimed", "failed"],
  ["claimed", "unknown"],
  ["claimed", "delivered"],
  ["claimed", "undelivered"],
  ["submitted", "delivered"],
  ["submitted", "undelivered"],
  ["submitted", "failed"],
  ["submitted", "unknown"],
  ["unknown", "delivered"],
  ["unknown", "undelivered"],
  ["unknown", "failed"],
  ["unknown", "submitted"],
];

describe("the delivery states", () => {
  it("are the ten of the definitions, split into unresolved and terminal", () => {
    expect([...DELIVERY_STATES].sort()).toEqual(["cancelled", "claimed", "delivered", "failed", "queued", "skipped", "skipped_env", "submitted", "undelivered", "unknown"]);
    expect([...UNRESOLVED_STATES].sort()).toEqual(["claimed", "queued", "submitted", "unknown"]);
    expect([...TERMINAL_STATES].sort()).toEqual(["cancelled", "delivered", "failed", "skipped", "skipped_env", "undelivered"]);
    expect([...UNRESOLVED_STATES, ...TERMINAL_STATES].sort()).toEqual([...DELIVERY_STATES].sort());
  });

  it("call a state terminal exactly when it is one", () => {
    for (const state of DELIVERY_STATES) expect(isTerminal(state), state).toBe((TERMINAL_STATES as readonly string[]).includes(state));
  });
});

describe("the delivery transitions", () => {
  it("allow exactly the twenty changes of the table, for every ordered pair of states", () => {
    let allowed = 0;
    for (const from of DELIVERY_STATES) {
      for (const to of DELIVERY_STATES) {
        const expected = ALLOWED.some(([a, b]) => a === from && b === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
        if (expected) allowed += 1;
      }
    }
    expect(allowed).toBe(ALLOWED.length);
  });

  it("are the rows of the table in the definitions, each with its cause", () => {
    expect(TRANSITION_TABLE).toHaveLength(13);
    for (const row of TRANSITION_TABLE) expect(row.cause).not.toBe("");
    const expanded = new Set(TRANSITION_TABLE.flatMap((row) => row.from.flatMap((from) => row.to.map((to) => `${from}>${to}`))));
    expect([...expanded].sort()).toEqual(ALLOWED.map(([a, b]) => `${a}>${b}`).sort());
  });

  it("never leave a terminal state, and never stay in the state a row is in", () => {
    for (const from of TERMINAL_STATES) for (const to of DELIVERY_STATES) expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
    for (const state of DELIVERY_STATES) expect(canTransition(state, state), state).toBe(false);
    // The two the story names.
    expect(canTransition("delivered", "failed")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
  });

  it("let a cancellation or a recipient's deletion stop only a row not yet handed to the provider", () => {
    expect(canStopBeforeHandOff("queued", false)).toBe(true);
    expect(canStopBeforeHandOff("claimed", false)).toBe(true);
    expect(canStopBeforeHandOff("claimed", true)).toBe(false);
    for (const state of ["submitted", "unknown", ...TERMINAL_STATES] as const) expect(canStopBeforeHandOff(state, false), state).toBe(false);
  });
});
