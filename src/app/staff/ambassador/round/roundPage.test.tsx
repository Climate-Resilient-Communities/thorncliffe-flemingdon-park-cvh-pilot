import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoundResponse } from "@/contracts/checkinRound";
import { RoundPage } from "./RoundPage";
import { contactHref, roundScreen } from "./view";

const REF_A = "3b0b8f9e-6a51-4c1e-9d2a-0b6f1c2d3e4f";
const REF_B = "4c1c9fa0-7b62-4d2f-8e3b-1c7f2d3e4f50";
const ROUND: RoundResponse = {
  rounds: [
    {
      headline: "Extreme heat in Thorncliffe Park. Cooling centres are open.",
      buildings: [
        {
          address: "4 Milepost Pl",
          floors: [
            {
              kind: "contacts",
              label: "3",
              requests: [
                { round_ref: REF_A, phone: "+14165550181", method: "call", status: "pending" },
                { round_ref: REF_B, phone: "+14165550182", method: "text", status: "needs_help" },
              ],
            },
            { kind: "counts", label: "4", counts: { pending: 2, done: 1, not_reached: 0, needs_help: 0 } },
          ],
        },
      ],
    },
  ],
};
const screen = roundScreen("ambassador");
const draw = (initial: Parameters<typeof RoundPage>[0]["initial"], role: Parameters<typeof roundScreen>[0] = "ambassador") =>
  renderToStaticMarkup(<RoundPage screen={roundScreen(role)} initial={initial} />);

describe("the round's words (A-04, S08.07)", () => {
  it("are the prototype's and the pilot's: the title, who sees what, and what a late mark is told", () => {
    expect(screen.title).toBe("My round");
    expect(roundScreen("admin").lead).toBe("Every check-in asked for in every open round. Ambassadors see only the floors they cover.");
    expect(roundScreen("coordinator").lead).toMatch(/^Counts only\./);
    expect(roundScreen("director").lead).toBe(roundScreen("coordinator").lead);
    expect(screen.keepOpen).toBe("Keep this page open until marks are sent");
    expect(screen.reload).toBe("Reload your round with signal");
    expect(screen.notes).toEqual({ hub_told: "The Hub has been told; call the Hub if you can", request_ended: "This request has ended", mark_failed: expect.any(String) });
    expect(`${screen.roundEnded.before}${screen.hub.label}${screen.roundEnded.after}`).toBe("This round has ended. If someone needs help, call the Hub at (416) 421-8997");
    expect(screen.hub.href).toBe("tel:+14164218997");
  });

  it("makes a call a tel: link and a text an sms: link, on the number in E.164", () => {
    expect(contactHref("call", "+14165550181")).toBe("tel:+14165550181");
    expect(contactHref("text", "+14165550181")).toBe("sms:+14165550181");
  });
});

describe("the round as drawn", () => {
  it("lists each request under its building and floor with its number as a call or text link, its round_ref and three marks, the current one pressed; counts only elsewhere", () => {
    const html = draw({ phase: "ready", round: ROUND });
    expect(html).toContain("For: Extreme heat in Thorncliffe Park. Cooling centres are open.");
    expect(html).toContain("3 to do · 1 done · 0 not reached · 1 need help");
    expect(html).toContain('<a class="tap hub-link" href="tel:+14165550181" data-testid="round-contact">Call (416) 555-0181</a>');
    expect(html).toContain('<a class="tap hub-link" href="sms:+14165550182" data-testid="round-contact">Text (416) 555-0182</a>');
    expect(html).toContain(`data-round-ref="${REF_A}"`);
    expect(html).toContain("Floor 3");
    expect(html).toContain("Marked: Needs help");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/data-testid="round-mark-done"/g)).toHaveLength(2);
    // The counted floor: counts and why, no number.
    expect(html).toContain("Floor 4");
    expect(html).toContain("2 to do · 1 done · 0 not reached · 0 need help");
    expect(html).toContain("Counts only: you do not cover this floor.");
    expect(html).toContain("When this disruption closes, these records are deleted. Only the counts are kept.");
  });

  it("says once, in the lead, that a Coordinator or a Director sees counts only, not on each floor", () => {
    const html = draw({ phase: "ready", round: ROUND }, "coordinator");
    expect(html).toContain("Counts only. The numbers are shown to the ambassadors who cover these floors, and to Admins.");
    expect(html).not.toContain("Counts only: you do not cover this floor.");
  });

  it("says how many marks wait, to keep the page open, and that there is no signal", () => {
    const html = draw({ phase: "ready", round: ROUND, online: false, waiting: [{ id: "x", roundRef: REF_A, status: "done" }] });
    expect(html).toContain('data-testid="round-offline"');
    expect(html).toContain("No signal. Your marks wait on this page and are sent, in order, when you have signal.");
    expect(html).toContain("1 mark is waiting to be sent.</span> Keep this page open until marks are sent");
    expect(html).toContain('data-testid="round-not-sent">Not sent yet.</p>');
    const two = draw({ phase: "ready", round: ROUND, waiting: [{ id: "x", roundRef: REF_A, status: "done" }, { id: "y", roundRef: REF_B, status: "done" }] });
    expect(two).toContain("2 marks are waiting to be sent.");
  });

  it("tells a late mark's answer on its row, and a round that has ended with the Hub's number as a tel: link", () => {
    const html = draw({ phase: "ready", round: ROUND, notes: { [REF_A]: "hub_told", [REF_B]: "round_ended" } });
    expect(html).toContain("The Hub has been told; call the Hub if you can");
    expect(html).toContain('data-tap-exempt="inline-text">This round has ended. If someone needs help, call the Hub at <a class="hub-link" href="tel:+14164218997">(416) 421-8997</a>');
    expect(draw({ phase: "ready", round: ROUND, notes: { [REF_A]: "request_ended" } })).toContain("This request has ended");
  });

  it("says what a waiting mark was answered above the round when its row is not shown (cleared, or read again without it), once per answer", () => {
    const REF_GONE = "5d2d0ab1-8c73-4e30-9f4c-2d8a3e4f5061";
    const cleared = draw({ phase: "cleared", notes: { [REF_A]: "round_ended", [REF_B]: "round_ended" } });
    expect(cleared).toContain('data-testid="round-note-loose" data-tap-exempt="inline-text">This round has ended. If someone needs help, call the Hub at <a class="hub-link" href="tel:+14164218997">(416) 421-8997</a>');
    expect(cleared.match(/round-note-loose/g)).toHaveLength(1);
    expect(cleared).toContain("Reload your round with signal");
    const ready = draw({ phase: "ready", round: ROUND, notes: { [REF_A]: "request_ended", [REF_GONE]: "hub_told" } });
    expect(ready).toContain('data-testid="round-note-loose" data-tap-exempt="inline-text">The Hub has been told; call the Hub if you can</p>');
    // A note for a row on the screen is said on that row only.
    expect(ready).toContain('data-testid="round-note" data-tap-exempt="inline-text">This request has ended</p>');
    expect(ready.match(/round-note-loose/g)).toHaveLength(1);
  });

  it("says to reload with signal once cleared, that no round is open, and that the session ended", () => {
    const cleared = draw({ phase: "cleared" });
    expect(cleared).toContain("Reload your round with signal");
    expect(cleared).toContain(">Reload my round</button>");
    expect(cleared).not.toContain("tel:+1416555");
    expect(draw({ phase: "ready", round: { rounds: [] } })).toContain("There is no check-in round right now.");
    expect(draw({ phase: "signed_out" })).toContain("You were signed out");
    expect(draw({ phase: "failed" })).toContain("Your round could not be loaded. Try again with signal.");
    expect(draw({ phase: "loading" })).toContain("Loading your round.");
  });
});
