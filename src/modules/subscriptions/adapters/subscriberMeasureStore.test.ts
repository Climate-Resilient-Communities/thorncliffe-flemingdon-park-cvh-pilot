// The receiving measures count the same states as the recipient list and the hand-off (S07.10): one list of receiving states, so the figures the Hub reports cannot
// drift from who is texted. Which of them receive now is `receivingSql` (S09.07), which the measures, the recipient list and the hand-off share.
import { describe, expect, it } from "vitest";
import { RECEIVING_MEASURE_STATES } from "./subscriberMeasureStore";
import { RECEIVING_STATES } from "./subscriberStore";

describe("the receiving measures", () => {
  it("count exactly the states in which a subscriber gets alerts", () => {
    expect(Object.values(RECEIVING_MEASURE_STATES).sort()).toEqual([...RECEIVING_STATES].sort());
  });
});
