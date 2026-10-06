// "My round" (A-04, S08.07) as the Hub screenshots and the layout tests draw it: a heat round in two buildings, with requests on the floors the Ambassador
// covers (a call and a text, unmarked and marked) and a floor they see as counts only. Every number is fictional (555-01xx).
import type { RoundResponse } from "../../src/contracts/checkinRound";

export const REF_A = "3b0b8f9e-6a51-4c1e-9d2a-0b6f1c2d3e4f";
export const REF_B = "4c1c9fa0-7b62-4d2f-8e3b-1c7f2d3e4f50";
export const REF_C = "5d2d0ab1-8c73-4e30-9f4c-2d8a3e4f5061";

export const ROUND: RoundResponse = {
  rounds: [
    {
      headline: "Extreme heat in Thorncliffe Park until Thursday. Cooling centres are open at the library and the community centre.",
      buildings: [
        {
          address: "4 Milepost Pl",
          floors: [
            {
              kind: "contacts",
              label: "3",
              requests: [
                { round_ref: REF_A, phone: "+14165550181", method: "call", status: "pending" },
                { round_ref: REF_B, phone: "+14165550182", method: "text", status: "done" },
              ],
            },
            { kind: "contacts", label: "4", requests: [{ round_ref: REF_C, phone: "+14165550183", method: "call", status: "needs_help" }] },
            { kind: "counts", label: "12", counts: { pending: 2, done: 1, not_reached: 1, needs_help: 0 } },
          ],
        },
      ],
    },
  ],
};

/** The same round as a Coordinator or a Director sees it: counts only. */
export const COUNTS_ONLY: RoundResponse = {
  rounds: [
    {
      headline: ROUND.rounds[0]!.headline,
      buildings: [
        {
          address: "4 Milepost Pl",
          floors: [
            { kind: "counts", label: "3", counts: { pending: 1, done: 1, not_reached: 0, needs_help: 0 } },
            { kind: "counts", label: "4", counts: { pending: 0, done: 0, not_reached: 0, needs_help: 1 } },
            { kind: "counts", label: "12", counts: { pending: 2, done: 1, not_reached: 1, needs_help: 0 } },
          ],
        },
        { address: "85-95 Thorncliffe Park Dr", floors: [{ kind: "counts", label: "7", counts: { pending: 3, done: 0, not_reached: 0, needs_help: 0 } }] },
      ],
    },
  ],
};
