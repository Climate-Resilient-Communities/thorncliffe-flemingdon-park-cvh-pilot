import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { englishText } from "@/i18n/text";
import type { OncallState } from "./control";
import { OncallFormsView, fieldsAfter, latestAnswer, shownAnswer, type OncallLabels, type OncallRow } from "./OncallFormsView";
import { OncallView } from "./OncallView";
import { onDutyView, type OnDutyEntry } from "./view";

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

describe("the on-duty Admin for check-ins (S08.08)", () => {
  const onDutyLabels = {
    heading: t("onDuty.heading"),
    lead: t("onDuty.lead"),
    badge: t("onDuty.badge"),
    number: t("onDuty.number"),
    account: t("onDuty.account"),
    accountHint: t("onDuty.accountHint"),
    noAccount: t("onDuty.noAccount"),
    noNumber: t("onDuty.noNumber"),
    set: t("onDuty.set"),
    setting: t("onDuty.setting"),
    clear: t("onDuty.clear"),
    clearing: t("onDuty.clearing"),
  };
  const ADMIN = "01900000-0000-7000-8000-0000000000c1";
  const entries = (onDuty: boolean): OnDutyEntry[] => [
    { id: rows[0]!.id, label: "IT lead", onDuty: false, staffId: null },
    { id: rows[1]!.id, label: "Priya", onDuty, staffId: onDuty ? ADMIN : null },
  ];
  const accounts = [{ id: ADMIN, name: "Priya Sharma" }];
  const draw = (state: "set" | "none" | "stale", list: OncallRow[] = rows, choices = accounts) =>
    renderToStaticMarkup(
      <OncallFormsView
        rows={list.map((row, index) => ({ ...row, onDuty: state !== "none" && index === 1 }))}
        labels={{ ...labels, onDuty: onDutyLabels }}
        answer={IDLE}
        onDuty={onDutyView({ entries: list.length === 0 ? [] : entries(state !== "none"), state, accounts: choices, onDutyName: "Priya Sharma" })}
      />,
    );

  it("says who is on duty, marks the entry, and chooses them in the form", () => {
    const html = draw("set");
    expect(html).toContain("On duty: Priya, Priya Sharma&#x27;s account.");
    expect(html).toContain('data-testid="oncall-row-on-duty"');
    expect(html).toMatch(/<option value="01900000-0000-7000-8000-0000000000b2" selected="">Priya<\/option>/);
    expect(html).toMatch(/<option value="01900000-0000-7000-8000-0000000000c1" selected="">Priya Sharma<\/option>/);
    expect(html).toContain("Nobody on duty");
    expect(html).toContain("Only an active Admin with an authenticator can be on duty");
  });

  it("says when nobody is on duty that escalations go to every number, with no button to end it", () => {
    const html = draw("none");
    expect(html).toContain("Nobody is on duty. Escalations go to every on-call number.");
    expect(html).not.toContain('data-testid="oncall-row-on-duty"');
    expect(html).not.toContain(">Nobody on duty<");
  });

  it("says when the entry's account can no longer be on duty, in the flag style", () => {
    const html = draw("stale");
    expect(html).toContain("Priya is on duty, but Priya Sharma&#x27;s account is no longer an active Admin with an authenticator.");
    expect(html).toMatch(/class="hub-flag hub-wrap"[^>]*data-state="stale"/);
  });

  it("offers no choice without a number on the list or an Admin with an authenticator", () => {
    expect(draw("none", [])).toContain("Add a number above first.");
    expect(draw("none", rows, [])).toContain("No Admin has an authenticator yet, so nobody can be on duty.");
    expect(draw("none", rows, [])).not.toContain("Set on duty");
  });

  it("never shows a whole number in the section", () => {
    const html = draw("set");
    const section = html.slice(html.indexOf('data-testid="oncall-on-duty"'), html.indexOf("</section>"));
    expect(section).not.toContain("0123");
  });

  it("shows the latest of all the forms' answers", () => {
    const one: OncallState = { status: "done", at: 1, lines: ["a"] };
    const two: OncallState = { status: "done", at: 2, lines: ["b"] };
    expect(latestAnswer(IDLE, one, two, IDLE)).toBe(two);
    expect(latestAnswer(IDLE, IDLE, IDLE, IDLE)).toEqual(IDLE);
  });
});

describe("the add form after a press (UAT F-1)", () => {
  const refused: OncallState = { status: "refused", message: t("errors.number_invalid"), at: 2 };
  const done: OncallState = { status: "done", lines: ["IT lead was added. The list now has 1 number."], at: 3 };
  const typed = { label: "Night IT", number: "12345" };

  it("keeps what was typed after a refusal and empties both fields once a number was added", () => {
    expect(fieldsAfter(refused, typed)).toEqual(typed);
    expect(fieldsAfter(done, typed)).toEqual({ label: "", number: "" });
    expect(fieldsAfter(IDLE, typed)).toEqual(typed);
  });

  it("shows a refusal until the person changes a field after it, and then never again", () => {
    expect(shownAnswer(refused, null)).toBe(refused);
    expect(shownAnswer(refused, 1)).toBe(refused);
    expect(shownAnswer(refused, 2)).toEqual(IDLE);
    expect(shownAnswer(done, 3)).toBe(done);
  });

  it("draws the fields with what the page keeps, and the refusal only while it is shown", () => {
    const fields = { label: "Night IT", number: "416-555-0123", onChange: () => {} };
    const kept = renderToStaticMarkup(<OncallFormsView rows={[]} labels={labels} answer={refused} addFields={fields} />);
    expect(kept).toContain('value="Night IT"');
    expect(kept).toContain('value="416-555-0123"');
    expect(kept).toContain('data-testid="oncall-error"');
    const typedAgain = renderToStaticMarkup(<OncallFormsView rows={[]} labels={labels} answer={shownAnswer(refused, 2)} addFields={fields} />);
    expect(typedAgain).not.toContain('data-testid="oncall-error"');
    expect(typedAgain).toContain('aria-describedby="oncall-number-hint"');
  });
});
