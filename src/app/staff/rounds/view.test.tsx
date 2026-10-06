import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EscalationBody } from "./escalation/EscalationBody";
import { HandleFormView } from "./escalation/HandleFormView";
import { RoundsBody } from "./RoundsBody";
import { ROUNDS_REFRESH_SECONDS, escalationScreen, residentView, roundsScreen, unreadableRounds, type DescribedEscalation, type ResidentFacts } from "./view";

const AT = new Date("2026-10-06T15:05:00Z");
const PHONE = "+14165550181";
const base: DescribedEscalation = {
  id: "0199b6f2-7c3a-7d41-9e2b-4f6a8c1d2e3f",
  status: "needs_help",
  building: "4 Milepost Pl",
  floor: "3",
  raisedBy: "Rashid Khan",
  late: false,
  createdAt: AT,
  handled: null,
};
const handled: DescribedEscalation = { ...base, id: "0199b6f2-7c3a-7d41-9e2b-4f6a8c1d2e40", status: "not_reached", handled: { at: new Date("2026-10-06T15:30:00Z"), by: "Priya Sharma", note: "Called her, all fine." } };
const late: DescribedEscalation = { ...base, id: "0199b6f2-7c3a-7d41-9e2b-4f6a8c1d2e41", late: true };
const LINKED: ResidentFacts = { kind: "linked", phone: PHONE, method: "call" };
const ADMIN = { followUp: true, aal2: true };
const COORDINATOR = { followUp: false, aal2: false };

describe("Check-in rounds (O-17): the escalations to follow up", () => {
  const screen = roundsScreen([base, handled, late]);
  const html = renderToStaticMarkup(<RoundsBody screen={screen} progress={null} />);

  it("puts the open escalations first and the handled ones after, each with status, building, floor, when and the ambassador", () => {
    expect(screen.open.map((item) => item.id)).toEqual([base.id, late.id]);
    expect(screen.handled.map((item) => item.id)).toEqual([handled.id]);
    expect(screen.open[0]).toMatchObject({
      statusLabel: "Needs help",
      where: "4 Milepost Pl, floor 3",
      marked: "Marked Tuesday, October 6, 2026 at 11:05 a.m. EDT",
      from: "From Rashid Khan, floor ambassador",
      late: null,
      href: `/staff/rounds/escalation?id=${base.id}`,
      openLabel: "Open Needs help, 4 Milepost Pl, floor 3",
    });
    expect(screen.handled[0]).toMatchObject({ statusLabel: "Not reached", handled: "Handled by Priya Sharma, Tuesday, October 6, 2026 at 11:30 a.m. EDT" });
  });

  it("asks the Hub to call the ambassador for a late mark's escalation", () => {
    expect(screen.open[1]!.late).toBe("Marked after the round ended: call the ambassador to follow up.");
    expect(html).toContain('data-testid="escalation-late"');
  });

  it("draws both lists and never a number", () => {
    expect(html).toContain("To follow up");
    expect(html).toContain("Handled in the last 7 days");
    expect(html).toContain("This page updates every 15 seconds.");
    expect(html).not.toMatch(/\+1\d{10}/);
  });

  it("renders again every 15 seconds, as its words say (the page mounts S06.09's AutoRefresh with it; the page's test checks that)", () => {
    expect(ROUNDS_REFRESH_SECONDS).toBe(15);
  });

  it("says when none is waiting, and when the list cannot be read", () => {
    expect(renderToStaticMarkup(<RoundsBody screen={roundsScreen([])} progress={null} />)).toContain("None waiting. Every escalation has been handled.");
    expect(renderToStaticMarkup(<RoundsBody screen={unreadableRounds()} progress={null} />)).toContain("The Hub could not read the escalations.");
  });

  it("names a staff member whose account is gone in plain words", () => {
    expect(roundsScreen([{ ...base, raisedBy: null }]).open[0]!.from).toBe("From a staff member, floor ambassador");
  });
});

describe("an escalation's page: the resident's details (Admins only) and the handling", () => {
  it("shows an Admin at aal2 the resident's number as a call link, the floor and the method, while the row names her", () => {
    const view = residentView(base, ADMIN, LINKED);
    expect(view).toEqual({
      kind: "shown",
      phone: PHONE,
      telHref: `tel:${PHONE}`,
      callLabel: `Call ${PHONE}`,
      floor: "3",
      method: "a call",
      note: "Only Admins see this. The Hub keeps it until the escalation is handled, or for 24 hours after the alert ends.",
    });
    const html = renderToStaticMarkup(<EscalationBody screen={escalationScreen(base, ADMIN, LINKED)} />);
    expect(html).toContain(`href="tel:${PHONE}"`);
    expect(html).toContain("Needs help: 4 Milepost Pl, floor 3");
  });

  it("shows anyone else no number: a Coordinator or Director is told only an Admin sees it, an Admin below aal2 to sign in with the code", () => {
    expect(residentView(base, COORDINATOR, LINKED)).toEqual({ kind: "admin_only", text: "Only an Admin sees the resident's number. Ask the on-duty Admin to follow up." });
    expect(residentView(base, { followUp: true, aal2: false }, LINKED)).toMatchObject({ kind: "aal2" });
    const html = renderToStaticMarkup(<EscalationBody screen={escalationScreen(base, COORDINATOR, LINKED)} />);
    expect(html).not.toContain(PHONE);
    expect(html).toContain("An Admin marks it handled.");
  });

  it("says the number is no longer kept once the row is a stub", () => {
    expect(residentView(base, ADMIN, { kind: "unlinked" })).toMatchObject({ kind: "gone" });
    expect(residentView(base, ADMIN, { kind: "linked", phone: null, method: "text" })).toMatchObject({ kind: "gone" });
  });

  it("has building, floor and ambassador only for a late mark's escalation, and asks the Hub to call the ambassador", () => {
    const screen = escalationScreen(late, ADMIN, LINKED);
    expect(screen.resident).toBeNull();
    expect(screen.late).toBe("Marked after the round ended. Only the building, floor and ambassador are known. Call the ambassador to follow up.");
    expect(renderToStaticMarkup(<EscalationBody screen={screen} />)).not.toContain(PHONE);
  });

  it("says who handled it and their note, and offers the form to an Admin only while it is open", () => {
    const done = escalationScreen(handled, ADMIN, { kind: "unlinked" });
    expect(done.handled).toEqual({ line: "Handled by Priya Sharma, Tuesday, October 6, 2026 at 11:30 a.m. EDT.", note: "What the Hub did: Called her, all fine." });
    expect(done.form).toBeNull();
    expect(escalationScreen(base, ADMIN, LINKED).form).toEqual({ kind: "mark" });
  });

  it("draws the form with a required one-line note of at most 300 characters, and a refusal as an alert", () => {
    const labels = { heading: "Mark handled", note: "What the Hub did", noteHint: "One line", mark: "Mark handled", marking: "Marking handled", noteMax: 300 };
    const open = renderToStaticMarkup(<HandleFormView id={base.id} open labels={labels} answer={{ status: "idle" }} />);
    expect(open).toMatch(/<input[^>]*id="escalation-note"[^>]*required=""[^>]*name="note"/);
    expect(open).toContain('maxLength="300"');
    expect(open).toContain(`name="id" value="${base.id}"`);
    const refused = renderToStaticMarkup(<HandleFormView id={base.id} open labels={labels} answer={{ status: "refused", at: 1, message: "Write what the Hub did." }} />);
    expect(refused).toContain('role="alert"');
    const closed = renderToStaticMarkup(<HandleFormView id={base.id} open={false} labels={labels} answer={{ status: "done", at: 1, line: "Marked handled." }} />);
    expect(closed).not.toContain("<form");
    expect(closed).toContain("Marked handled.");
  });
});
