import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { procedureLink } from "../procedures";
import { MeasuresView } from "./MeasuresView";
import type { MeasuresView as MeasuresViewModel } from "./view";

const model = (cost: MeasuresViewModel["cost"]): MeasuresViewModel => ({
  title: "Pilot measures",
  lead: "Counts only.",
  privacy: 'A number from 1 to 4 is shown as "Fewer than 5".',
  exportNote: "The full set for the week-8 review is a file an Admin writes each day.",
  procedure: procedureLink("export-measures"),
  subscribers: {
    heading: "Subscribers",
    lead: "Counted by the daily job for October 4, 2026.",
    measures: [{ id: "receiving_active", name: "Receiving texts", total: "All: 62", byLanguage: "By language: English: 40; Urdu: Fewer than 5", byNeighbourhood: "By neighbourhood: Thorncliffe Park: 62" }],
  },
  reach: {
    heading: "How far corrections reached",
    lead: "Measured against the original.",
    real: [{ id: "e1", title: "Correction, approved October 4, 2026", lines: ["Got the original: 120", "Attempted: 118", "Confirmed: 100", "Attempted 98% and confirmed 83%"] }],
    realEmpty: "None yet.",
    drillsHeading: "Drills, kept apart",
    drills: [{ id: "d1", title: "Final, approved October 4, 2026", lines: ["Got the original: Fewer than 5"] }],
    drillsEmpty: "No drill.",
  },
  cost,
});

describe("the pilot measures page", () => {
  it("draws the subscribers, the reach with drills in a list of their own, and no control", () => {
    const html = renderToStaticMarkup(<MeasuresView view={model(null)} />);
    expect(html).toContain("<h1>Pilot measures</h1>");
    expect(html).toContain('data-testid="measure-receiving_active"');
    expect(html).toContain("By language: English: 40; Urdu: Fewer than 5");
    expect(html).toContain('data-testid="measures-reach-real"');
    expect(html).toContain('data-testid="measures-reach-drills"');
    expect(html).not.toMatch(/<(button|input|select|textarea|form)\b/);
    // The cost section is not drawn for a role that does not see spend (AD-4).
    expect(html).not.toContain('data-testid="measures-cost"');
  });

  it("draws the cost section only when the model has one, with its drills apart and the Cohere share", () => {
    const html = renderToStaticMarkup(
      <MeasuresView
        view={model({
          heading: "Cost per alert",
          lead: "Text message cost by language.",
          real: [{ id: "c1", title: "Acknowledgement, approved October 4, 2026", lines: ["All languages: 55 texts. $1.205 CAD (estimate)"] }],
          realEmpty: "None.",
          drillsHeading: "Drills, kept apart",
          drills: [],
          drillsEmpty: "No drill has texts with a recorded cost.",
          cohere: { heading: "Cohere use by alerts", lead: "Share of use.", empty: "None.", lines: ["2026-10: alerts used 25% of the billed tokens (10 of 40 calls)."] },
        })}
      />,
    );
    expect(html).toContain('data-testid="measures-cost"');
    expect(html).toContain('data-testid="measures-cost-real"');
    expect(html).not.toContain('data-testid="measures-cost-drills"');
    expect(html).toContain("No drill has texts with a recorded cost.");
    expect(html).toContain('data-testid="measures-cohere"');
  });

  it("says under the lead where the full set of measures is, with the export's procedure as the page's one link (S09.05)", () => {
    const html = renderToStaticMarkup(<MeasuresView view={model(null)} />);
    expect(html).toContain('<p data-testid="measures-export">The full set for the week-8 review is a file an Admin writes each day.</p>');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('data-procedure="export-measures"');
    expect(html).toContain("/docs/procedures/export-measures.md");
    expect(html.indexOf('data-testid="measures-export"')).toBeLessThan(html.indexOf('data-testid="measures-subscribers"'));
  });

  it("says when there is nothing to list, instead of an empty list", () => {
    const empty = model(null);
    empty.reach.real = [];
    const html = renderToStaticMarkup(<MeasuresView view={empty} />);
    expect(html).toContain('data-testid="measures-reach-empty"');
    expect(html).not.toContain('data-testid="measures-reach-real"');
  });
});
