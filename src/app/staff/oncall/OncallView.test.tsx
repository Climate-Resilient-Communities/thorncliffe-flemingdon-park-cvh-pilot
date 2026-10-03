import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { englishText } from "@/i18n/text";
import type { OncallState } from "./control";
import { OncallFormsView, latestAnswer, type OncallLabels, type OncallRow } from "./OncallFormsView";
import { OncallView } from "./OncallView";

const t = (key: string) => englishText(`staff.oncall.${key}`);
const labels: OncallLabels = {
  listHeading: t("listHeading"),
  empty: t("empty"),
  emptyConsequence: t("emptyConsequence"),
  hidden: t("hidden"),
  addHeading: t("addHeading"),
  label: t("label"),
  labelHint: t("labelHint"),
  number: t("number"),
  numberHint: t("numberHint"),
  add: t("add"),
  adding: t("adding"),
  remove: t("remove"),
  removing: t("removing"),
};
const IDLE: OncallState = { status: "idle" };
const rows: OncallRow[] = [
  { id: "01900000-0000-7000-8000-0000000000b1", label: "IT lead", masked: "+1 ••• ••• 0123", removeFor: "Remove IT lead" },
  { id: "01900000-0000-7000-8000-0000000000b2", label: "Priya", masked: "+1 ••• ••• 0199", removeFor: "Remove Priya" },
];
const page = (list: readonly OncallRow[], answer: OncallState = IDLE, unreadable = false) =>
  renderToStaticMarkup(<OncallView count={list.length} unreadable={unreadable} forms={<OncallFormsView rows={list} labels={labels} answer={answer} />} />);

describe("the On-call numbers page with numbers on the list", () => {
  const html = page(rows);

  it("says who is texted and when an alert needs a number", () => {
    expect(html).toContain("On-call numbers");
    expect(html).toContain("The Admins who get a text when sending is stuck or failing");
    expect(html).toContain("Once texts are going out, no alert except a drill can be approved while this list is empty.");
    expect(html).toContain("2 on-call numbers");
  });

  it("lists each number with its name and only its last four digits, and a Remove button that names it", () => {
    expect(html).toContain("IT lead");
    expect(html).toContain("+1 ••• ••• 0123");
    expect(html).toContain('aria-label="Remove IT lead"');
    expect(html).toContain('aria-label="Remove Priya"');
    expect(html).toContain("Only the last four digits of a number are shown.");
    // The list itself holds no whole number (the form's hint has an example, which is not one on the list).
    const list = html.slice(html.indexOf('data-testid="oncall-list"'), html.indexOf("</ul>"));
    expect(list).not.toMatch(/\d{3}[-. ]\d{3}[-. ]\d{4}/);
    expect(list).not.toContain("+1416");
  });

  it("puts the entry's id in a hidden field of its own Remove form", () => {
    expect(html).toContain('name="id" value="01900000-0000-7000-8000-0000000000b1"');
  });

  it("offers the add form with a required name (at most 40 characters) and number, each with its hint", () => {
    expect(html).toMatch(/<input[^>]*id="oncall-label"[^>]*required=""/);
    expect(html).toContain('maxLength="40"');
    expect(html).toMatch(/<input[^>]*id="oncall-number"[^>]*type="tel"/);
    expect(html).toContain("A Canadian number, for example 416-555-0123.");
    expect(html).toContain("Add number");
    expect(html).not.toContain("No on-call number is set.");
  });
});

describe("the On-call numbers page with an empty list", () => {
  const html = page([]);

  it("says no number is set and what that means, in words", () => {
    expect(html).toContain("No on-call number is set.");
    expect(html).toContain('data-testid="oncall-empty"');
    expect(html).toContain("0 on-call numbers");
    expect(html).not.toContain("Remove");
  });

  it("says '1 on-call number' in the singular", () => {
    expect(page([rows[0]])).toContain("1 on-call number");
  });
});

describe("what a press leaves", () => {
  it("shows the lines of a change in the live region", () => {
    const html = page(rows, { status: "done", at: 1, lines: ["IT lead was added. The list now has 2 numbers."] });
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("IT lead was added. The list now has 2 numbers.");
    expect(html).not.toContain('role="alert"');
  });

  it("shows a refusal as an alert in the Hub's error style, tied to the number field", () => {
    const html = page(rows, { status: "refused", at: 1, message: "That number is already on the list." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("hub-error");
    expect(html).toContain("That number is already on the list.");
    expect(html).toContain('aria-describedby="oncall-number-hint oncall-error"');
  });

  it("says a roster that could not be read, and still shows the forms", () => {
    const html = page([], IDLE, true);
    expect(html).toContain('data-testid="oncall-unreadable"');
    expect(html).toContain("could not read the on-call numbers");
    expect(html).toContain("Add number");
  });

  it("shows the later of the two forms' answers", () => {
    const earlier: OncallState = { status: "done", at: 1, lines: ["a"] };
    const later: OncallState = { status: "refused", at: 2, message: "b" };
    expect(latestAnswer(earlier, later)).toBe(later);
    expect(latestAnswer(later, earlier)).toBe(later);
    expect(latestAnswer(IDLE, earlier)).toBe(earlier);
    expect(latestAnswer(earlier, IDLE)).toBe(earlier);
  });

  it("disables the buttons and changes their words while a press is under way", () => {
    const html = renderToStaticMarkup(<OncallFormsView rows={rows} labels={labels} answer={IDLE} adding removing />);
    expect(html).toContain("Adding number");
    expect(html).toContain("Removing");
    expect(html).toContain("disabled");
  });
});
