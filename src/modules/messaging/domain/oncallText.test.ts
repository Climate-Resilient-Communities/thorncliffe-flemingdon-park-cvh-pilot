import { describe, expect, it } from "vitest";
import { ONCALL_TEXT_CONDITIONS, renderEscalationText, renderOncallText } from "./oncallText";
import { looksLikePhoneNumber } from "./phoneNumber";

describe("renderOncallText (AD-21, S06.07)", () => {
  it.each(ONCALL_TEXT_CONDITIONS)("%s is one gsm7 segment, whatever the count, with nothing unfilled and no number", (condition) => {
    for (const count of [0, 1, 12, 1_000_000]) {
      const text = renderOncallText(condition, count);
      expect(text).toMatchObject({ encoding: "gsm7", segments: 1 });
      expect(text.body.startsWith("CVH:")).toBe(true);
      expect(text.body).not.toMatch(/[{}]/);
      expect(looksLikePhoneNumber(text.body)).toBe(false);
    }
  });
});

describe("renderEscalationText (AD-21, S08.08, E08 'Escalation')", () => {
  // The production base URL of docs/config.md, an escalation id (a UUID v7) and the register's longest address in the pilot's buildings.
  const LINK = "https://project-6qcs4.vercel.app/staff/rounds/escalation?id=0199b6f2-7c3a-7d41-9e2b-4f6a8c1d2e3f";

  it("says the status, building, floor and the staff link, after the on-call texts' CVH:", () => {
    expect(renderEscalationText({ status: "needs_help", building: "25 Thorncliffe Park Dr", floor: "12", link: LINK }).body).toBe(`CVH: Needs help: 25 Thorncliffe Park Dr, floor 12. Open: ${LINK}`);
    expect(renderEscalationText({ status: "not_reached", building: "25 Thorncliffe Park Dr", floor: "12", link: LINK }).body).toBe(`CVH: Not reached: 25 Thorncliffe Park Dr, floor 12. Open: ${LINK}`);
  });

  it("is one GSM-7 segment for the pilot's longest address and a floor label of up to 4 characters, with nothing unfilled and no number", () => {
    for (const status of ["needs_help", "not_reached"] as const) {
      const text = renderEscalationText({ status, building: "85-95 THORNCLIFFE PARK DR", floor: "PH12", link: LINK });
      expect(text).toMatchObject({ encoding: "gsm7", segments: 1 });
      expect(text.body).not.toMatch(/[{}]/);
      expect(looksLikePhoneNumber(text.body)).toBe(false);
    }
  });

  it("stays at most two segments for a longer address, floor label and base URL (a custom domain)", () => {
    const text = renderEscalationText({ status: "not_reached", building: "1 A Very Long Street Name, Building B", floor: "Penthouse 12", link: LINK.replace("project-6qcs4.vercel.app", "check-ins.community-hub.example.org") });
    expect(text.segments).toBeLessThanOrEqual(2);
  });
});
