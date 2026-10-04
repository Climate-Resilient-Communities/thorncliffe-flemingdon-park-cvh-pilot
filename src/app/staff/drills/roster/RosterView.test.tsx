import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { englishText } from "@/i18n/text";
import type { RosterState } from "./control";
import { RosterFormsView, latestAnswer, type RosterLabels, type RosterRow } from "./RosterFormsView";
import { RosterView } from "./RosterView";
import { languageChoices } from "./view";

const t = (key: string) => englishText(`staff.drillRoster.${key}`);
const labels: RosterLabels = {
  listHeading: t("listHeading"),
  empty: t("empty"),
  emptyConsequence: t("emptyConsequence"),
  hidden: t("hidden"),
  addHeading: t("addHeading"),
  label: t("label"),
  labelHint: t("labelHint"),
  number: t("number"),
  numberHint: t("numberHint"),
  language: t("language"),
  add: t("add"),
  adding: t("adding"),
  edit: t("edit"),
  editNumberHint: t("editNumberHint"),
  save: t("save"),
  saving: t("saving"),
  remove: t("remove"),
  removing: t("removing"),
};
const IDLE: RosterState = { status: "idle" };
const languages = languageChoices();
const rows: RosterRow[] = [
  { id: "01900000-0000-7000-8000-0000000000b1", label: "Hub phone", masked: "+1 ••• ••• 0123", lang: "en", languageLine: "Drill text in English", editFor: "Edit Hub phone", removeFor: "Remove Hub phone" },
  { id: "01900000-0000-7000-8000-0000000000b2", label: "Priya", masked: "+1 ••• ••• 0199", lang: "ur", languageLine: "Drill text in Urdu", editFor: "Edit Priya", removeFor: "Remove Priya" },
];
const page = (list: readonly RosterRow[], answer: RosterState = IDLE, unreadable = false) =>
  renderToStaticMarkup(<RosterView count={list.length} unreadable={unreadable} forms={<RosterFormsView rows={list} languages={languages} labels={labels} answer={answer} />} />);

describe("the drill roster page with phones on it", () => {
  const html = page(rows);

  it("says who is texted and links back to the Drills page", () => {
    expect(html).toContain("Drill roster");
    expect(html).toContain("A drill never reaches a resident.");
    expect(html).toContain("2 phones on the roster");
    expect(html).toContain('href="/staff/drills"');
  });

  it("lists each phone with its name, only its last four digits and the language of its drill text, with an Edit and a Remove that name it", () => {
    for (const text of ["Hub phone", "+1 ••• ••• 0123", "Drill text in English", "Drill text in Urdu"]) expect(html).toContain(text);
    expect(html).toContain('aria-label="Remove Priya"');
    expect(html).toContain('aria-label="Edit Priya"');
    expect(html).toContain("Only the last four digits of a number are shown.");
    const list = html.slice(html.indexOf('data-testid="drill-roster-list"'), html.indexOf("</ul>"));
    expect(list).not.toMatch(/\d{3}[-. ]\d{3}[-. ]\d{4}/);
    expect(list).not.toContain("+1416");
  });

  it("puts the member's id in a hidden field of each of its forms, and never the number in an Edit form (an empty number keeps it)", () => {
    expect(html).toContain('name="id" value="01900000-0000-7000-8000-0000000000b1"');
    expect(html).toContain("Leave empty to keep the number.");
    expect(html).not.toMatch(/name="number"[^>]*value=/);
  });

  it("offers the add form with a required name (at most 40 characters) and number, a language list that starts with English, and each hint", () => {
    expect(html).toMatch(/<input[^>]*id="drill-roster-label"[^>]*required=""/);
    expect(html).toContain('maxLength="40"');
    expect(html).toMatch(/<input[^>]*id="drill-roster-number"[^>]*type="tel"/);
    expect(html).toContain("A Canadian number, for example 416-555-0123.");
    expect(html).toMatch(/<select[^>]*id="drill-roster-lang"[^>]*name="lang"/);
    expect(html.indexOf(">English</option>")).toBeLessThan(html.indexOf(">Urdu</option>"));
    expect(html).toContain("Add phone");
    expect(html).not.toContain("The drill roster is empty.");
  });

  it("selects each member's own language in its Edit form", () => {
    expect(html).toMatch(/<option value="ur" selected="">Urdu<\/option>/);
  });
});

describe("the drill roster page with an empty roster", () => {
  it("says it is empty and what that means, and offers no Remove", () => {
    const html = page([]);
    expect(html).toContain("The drill roster is empty.");
    expect(html).toContain("A drill reaches no one until you add a phone.");
    expect(html).toContain('data-testid="drill-roster-empty"');
    expect(html).toContain("0 phones on the roster");
    expect(html).not.toContain("Remove");
  });

  it("says '1 phone on the roster' in the singular", () => {
    expect(page([rows[0]])).toContain("1 phone on the roster");
  });
});

describe("what a press leaves", () => {
  it("shows the lines of a change in the live region", () => {
    const html = page(rows, { status: "done", at: 1, lines: ["Hub phone was added. The roster now has 2 phones."] });
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Hub phone was added. The roster now has 2 phones.");
    expect(html).not.toContain('role="alert"');
  });

  it("shows a refusal as an alert in the Hub's error style, tied to the number field", () => {
    const html = page(rows, { status: "refused", at: 1, message: "That number is already on the roster." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("hub-error");
    expect(html).toContain("That number is already on the roster.");
    expect(html).toContain('aria-describedby="drill-roster-number-hint drill-roster-error"');
  });

  it("says a roster that could not be read, and still shows the forms", () => {
    const html = page([], IDLE, true);
    expect(html).toContain('data-testid="drill-roster-unreadable"');
    expect(html).toContain("could not read the drill roster");
    expect(html).toContain("Add phone");
  });

  it("shows the latest of the forms' answers", () => {
    const earlier: RosterState = { status: "done", at: 1, lines: ["a"] };
    const later: RosterState = { status: "refused", at: 2, message: "b" };
    expect(latestAnswer(earlier, later)).toBe(later);
    expect(latestAnswer(later, earlier, IDLE)).toBe(later);
    expect(latestAnswer(IDLE, earlier)).toBe(earlier);
    expect(latestAnswer(IDLE, IDLE)).toEqual(IDLE);
  });

  it("disables the buttons and changes their words while a press is under way", () => {
    const html = renderToStaticMarkup(<RosterFormsView rows={rows} languages={languages} labels={labels} answer={IDLE} busy />);
    expect(html).toContain("Adding phone");
    expect(html).toContain("Removing");
    expect(html).toContain("Saving changes");
    expect(html).toContain("disabled");
  });
});

describe("the languages a phone can be texted in", () => {
  it("are every language code, English first, each named in English", () => {
    expect(languages[0]).toEqual({ code: "en", name: "English" });
    expect(languages).toHaveLength(16);
    expect(languages.find((language) => language.code === "zh-Hant")?.name).toBe("Chinese (Traditional)");
  });
});
