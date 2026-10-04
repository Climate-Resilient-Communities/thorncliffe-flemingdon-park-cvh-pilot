import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APPROVER, ENGLISH, ENTRY, ALERT, HASH, OTHER_ALERT, OTHER_ENTRY, PLANS, reviewOf } from "../../../../../test/helpers/approvalReview";
import { ApprovalBody, type ApprovalActions } from "./ApprovalBody";
import { approvalScreen, countChangedView, type ApprovalScreen } from "./view";

const noop = async () => ({ status: "idle" as const });
const actions: ApprovalActions = { approve: noop, returnToAuthor: noop, discard: noop };

const screenOf = (options: Parameters<typeof reviewOf>[0] = {}): ApprovalScreen => approvalScreen({ review: reviewOf(options), plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER });
const html = (screen: ApprovalScreen, initial?: Parameters<typeof ApprovalBody>[0]["initial"]) => renderToStaticMarkup(<ApprovalBody screen={screen} actions={actions} initial={initial} />);
const region = (out: string) => out.slice(out.indexOf('class="layout-screen__actions"'));

describe("the approval view (O-05), waiting for a second person", () => {
  const out = html(screenOf());

  it("shows the English text, the audience in words, the channels, the recipient count, the estimated cost and the valid-until, before the languages", () => {
    expect(out).toContain("<h1>Approve an alert</h1>");
    expect(out).toMatch(/<p[^>]*data-testid="english-body"[^>]*>The elevator at 4 Milepost Pl/);
    expect(out).toContain(ENGLISH);
    expect(out).toContain('data-testid="audience-sentence"');
    expect(out).toContain("Residents of 4 Milepost Pl (floors 3, 4) and 85-95 Thorncliffe Park Dr (all floors).");
    expect(out).toContain('data-testid="fact-channels"');
    expect(out).toContain('data-testid="recipient-count">0<');
    expect(out).toContain("Text sign-up is not open yet.");
    expect(out).toContain('data-testid="estimated-cost">$0.00 CAD<');
    expect(out).toContain('data-testid="fact-valid-until"');
    // The aside, with every other language, comes after all of that in the document, so on a phone it is below the fold.
    for (const id of ["english-body", "audience-sentence", "fact-channels", "recipient-count", "estimated-cost", "fact-valid-until"]) {
      expect(out.indexOf(`data-testid="${id}"`), id).toBeLessThan(out.indexOf('data-testid="approval-aside"'));
    }
  });

  it("lists the web as the only channel before E07, and does not list texts", () => {
    const channels = out.slice(out.indexOf('data-testid="fact-channels"'), out.indexOf('data-testid="fact-recipients"'));
    expect(channels).toContain("Web app, in every launch language.");
    expect(channels).not.toContain("Text messages");
  });

  it("puts every other language, with its web text and its text message, one tap away in the aside: a closed disclosure each", () => {
    const aside = out.slice(out.indexOf('data-testid="approval-aside"'));
    expect(aside.match(/<details>/g)).toHaveLength(16);
    expect(aside).not.toContain("<details open");
    expect(aside).toContain('data-testid="web-ur"');
    expect(aside).toContain('data-testid="sms-ur"');
    expect(aside).toContain('data-testid="sms-en"');
    expect(aside).not.toContain('data-testid="web-en"');
    // zh-Hant has a web text and no text message.
    expect(aside).toContain('data-testid="web-zh-Hant"');
    expect(aside).not.toContain('data-testid="sms-zh-Hant"');
    // The summary of each is a tap target, in the language's own script and direction.
    expect(aside).toMatch(/<summary class="tap hub-summary"><span class="hub-wrap"><strong lang="ur" dir="rtl">اردو<\/strong> Urdu · Machine translation/);
    // English is named once: its native name is its English one.
    expect(aside).toMatch(/<summary class="tap hub-summary"><span class="hub-wrap"><strong lang="en" dir="ltr">English<\/strong> · The text above/);
    expect(aside.match(/<summary class="tap hub-summary">/g)).toHaveLength(16);
  });

  it("has Approve first in the sticky actions region, then Return to author and Discard, all at the block end and none a way to edit", () => {
    const bar = region(out);
    expect(bar).toContain('aria-label="Approval actions"');
    expect(bar).toMatch(/<button[^>]*type="submit"[^>]*form="approve-form"[^>]*data-testid="approve-button">Approve<\/button>/);
    expect(bar.indexOf('data-testid="approve-button"')).toBeLessThan(bar.indexOf('data-testid="return-button"'));
    expect(bar.indexOf('data-testid="return-button"')).toBeLessThan(bar.indexOf('data-testid="discard-button"'));
    expect(bar).toContain("Return to author");
    expect(bar).toContain(">Discard<");
    expect(bar.match(/<button/g)).toHaveLength(3);
    expect(out.toLowerCase()).not.toMatch(/edit and approve|approve and edit/);
    expect(bar.toLowerCase()).not.toContain("edit");
  });

  it("carries what the approver was shown, and the count reviewed, in hidden fields of the approve form", () => {
    const form = out.slice(out.indexOf('id="approve-form"'), out.indexOf("</form>", out.indexOf('id="approve-form"')));
    expect(form).toContain(`name="alert" value="${ALERT}"`);
    expect(form).toContain(`name="entry" value="${ENTRY}"`);
    expect(form).toContain('name="version" value="2"');
    expect(form).toContain(`name="hash" value="${HASH}"`);
    expect(form).toContain('name="reviewed"');
    expect(form).toContain("&quot;total&quot;:0");
  });

  it("uses the Hub's two columns, the main content first and the aside after it", () => {
    expect(out).toContain('class="layout-grid" data-two-column="aside"');
    const grid = out.slice(out.indexOf('data-two-column="aside"'));
    expect(grid.indexOf('data-testid="english-text"')).toBeLessThan(grid.indexOf('data-testid="approval-aside"'));
  });

  it("explains that the text cannot be changed here, and why", () => {
    expect(out).toContain("You cannot change this text: whoever changes it becomes an editor and cannot approve it.");
  });

  it("has no return form, no discard form and no count to confirm until they are asked for", () => {
    expect(out).not.toContain('data-testid="return-form"');
    expect(out).not.toContain('data-testid="discard-form"');
    expect(out).not.toContain('data-testid="count-changed"');
    expect(out).not.toContain('role="alert"');
  });
});

describe("what a screen with languages that fell back, a duplicate and a drill adds", () => {
  const out = html(screenOf({ fallback: ["ur", "ps"], duplicate: { alertId: OTHER_ALERT, entryId: OTHER_ENTRY }, thread: { isDrill: true } }));

  it("flags the fallback languages above the fold, in the main column, with the English text they show", () => {
    expect(out).toContain('data-testid="fallback-summary"');
    expect(out).toContain("2 of 15 languages could not be translated: Urdu and Pashto.");
    expect(out.indexOf('data-testid="fallback-summary"')).toBeLessThan(out.indexOf('data-testid="approval-aside"'));
    expect(out).not.toContain('data-testid="all-translated"');
    expect(out).toContain('data-state="fallback_en"');
  });

  it("links to the possible duplicate, and says so", () => {
    expect(out).toContain('data-testid="duplicate-note"');
    expect(out).toContain(`href="/staff/alerts/approve?alert=${OTHER_ALERT}&amp;entry=${OTHER_ENTRY}"`);
    expect(out).toContain("Open the other alert");
  });

  it("marks a drill as one", () => {
    expect(out).toContain('data-testid="drill-note"');
    expect(out).toContain("This is a drill. It never reaches residents.");
  });
});

describe("the review of an ambassador's post (O-07)", () => {
  const out = html(screenOf({ authorRole: "ambassador" }));

  it("says so, how residents see it, and offers Approve, Return to author and Discard, never an edit", () => {
    expect(out).toContain("<h1>Review an ambassador post</h1>");
    expect(out).toContain('data-testid="ambassador-note"');
    expect(out).toContain("Residents see it as from a building ambassador.");
    const bar = region(out);
    expect(bar).toContain(">Approve<");
    expect(bar).toContain("Return to author");
    expect(bar).toContain(">Discard<");
    expect(bar.match(/<button/g)).toHaveLength(3);
    expect(out.toLowerCase()).not.toMatch(/edit and approve|decline/);
    expect(out).not.toContain('data-testid="live-note"');
  });

  it("for a post residents already read (D-1, S08.03) says so and offers Approve and Discard only: a web-published entry never returns to draft", () => {
    const live = html(screenOf({ authorRole: "ambassador", entry: { webPublishedAt: new Date("2026-10-04T14:00:00.000Z") } }));
    expect(live).toMatch(/<p[^>]*data-testid="live-note"[^>]*>Residents already read this post on the web, marked &quot;Not yet verified&quot;\./);
    const bar = region(live);
    expect(bar).toContain(">Approve<");
    expect(bar).toContain(">Discard<");
    expect(bar).not.toContain("Return to author");
    expect(bar).not.toContain('data-testid="return-button"');
    expect(bar.match(/<button/g)).toHaveLength(2);
  });
});

describe("Return to author and Discard", () => {
  it("open a form with a required note, a counter and the action in the sticky region, and a way back", () => {
    const out = html(screenOf(), { mode: "return" });
    expect(out).toContain('data-testid="return-form"');
    expect(out).toMatch(/<textarea[^>]*id="return-note"[^>]*name="note"[^>]*required=""/);
    expect(out).toContain('for="return-note"');
    expect(out).toContain("Note to the author");
    expect(out).toContain("0 of 500 characters");
    const bar = region(out);
    expect(bar).toMatch(/<button[^>]*type="submit"[^>]*form="return-form"[^>]*data-testid="send-back-button">Send back with this note<\/button>/);
    expect(bar).toContain('data-testid="cancel-button"');
    expect(bar).not.toContain('data-testid="approve-button"');
    // The return form names the entry and what was shown, so a changed entry is refused.
    const form = out.slice(out.indexOf('id="return-form"'));
    expect(form).toContain('name="version" value="2"');
    expect(form).toContain(`name="hash" value="${HASH}"`);
  });

  it("open a confirmation for a discard, with the action in the sticky region and a way back", () => {
    const out = html(screenOf(), { mode: "discard" });
    expect(out).toContain('data-testid="discard-form"');
    expect(out).toContain("It is never published and cannot be brought back.");
    const bar = region(out);
    expect(bar).toMatch(/<button[^>]*type="submit"[^>]*form="discard-form"[^>]*data-testid="discard-confirm-button">Discard it<\/button>/);
    expect(bar).toContain('data-testid="cancel-button"');
  });

  it("show a refusal as an alert, in the page, whichever form was sent", () => {
    const out = html(screenOf(), { mode: "return", returnToAuthor: { status: "refused", message: "Write a note for the author." } });
    expect(out).toMatch(/<p id="approval-error" role="alert" class="hub-error" data-testid="approval-error">Write a note for the author\.<\/p>/);
  });
});

describe("a count that changed", () => {
  const review = reviewOf({ recipients: { open: true, total: 5, byLanguage: { en: 3, ur: 2 } } });
  const view = countChangedView({ review, snapshot: { total: 7, byLanguage: { en: 3, ur: 4 } }, reviewed: { total: 5, byLanguage: { en: 3, ur: 2 } }, pricePerSegmentCents: 1.5 });
  const out = html(approvalScreen({ review, plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER }), { approve: { status: "count_changed", view } });

  it("says from what to what, lists the new number per language with its cost, and asks to confirm it", () => {
    expect(out).toContain('data-testid="count-changed"');
    expect(out).toContain("The number of people who will get this text changed from 5 to 7");
    expect(out).toContain('data-testid="count-en"');
    expect(out).toContain("Urdu: 4");
    expect(out).toContain("Estimated cost now: $0.33 CAD (an estimate)");
    const checkbox = out.match(/<input type="checkbox"[^>]*data-testid="confirm-count"[^>]*\/>/)?.[0] ?? "";
    expect(checkbox).toContain('name="confirm-count"');
    expect(checkbox).toContain('form="approve-form"');
    expect(checkbox).toContain('required=""');
    expect(out).toContain("I have read the new number and I still want to approve.");
  });

  it("makes the next Approve name the new count, and keeps Approve out of reach until it is confirmed", () => {
    const form = out.slice(out.indexOf('id="approve-form"'), out.indexOf("</form>", out.indexOf('id="approve-form"')));
    expect(form).toContain("&quot;total&quot;:7");
    const bar = region(out);
    expect(bar).toMatch(/<button[^>]*disabled=""[^>]*data-testid="approve-button">Confirm the new number and approve<\/button>/);
  });
});

describe("an entry that is not waiting for this person", () => {
  it("says what became of it and has no actions, no forms and no sticky region", () => {
    const out = html(screenOf({ entry: { status: "approved" } }));
    expect(out).toContain('data-testid="locked-note"');
    expect(out).toContain("This alert was approved and is published.");
    expect(out).not.toContain("layout-screen__actions");
    expect(out).not.toContain('data-testid="approve-form"');
    expect(out).not.toContain('data-testid="approve-button"');
    // What it said is still there to read.
    expect(out).toContain(ENGLISH);
  });

  it("shows the note an approver sent back with", () => {
    const out = html(screenOf({ entry: { status: "draft", contentHash: null, submittedAt: null, returnedFor: "return", returnedNote: "Say which floors." } }));
    expect(out).toContain("sent back to its author with a note");
    expect(out).toContain("The note sent: Say which floors.");
  });
});

describe("the published confirmation (O-06), once the entry is approved", () => {
  const published = (options: Parameters<typeof reviewOf>[0] = {}) => html(screenOf({ ...options, entry: { status: "approved", ...options.entry } }));

  it("is the screen of an approved entry: 'The acknowledgement is out', what went where, then the English text and what happens next, with the aside after them", () => {
    const out = published({ fallback: ["ur", "ps"] });
    expect(out).toContain('<h1 class="hub-wrap" data-testid="published-title">The acknowledgement is out</h1>');
    for (const id of ["where-web", "where-fallback", "where-texts", "where-valid"]) expect(out, id).toContain(`data-testid="${id}"`);
    const order = ["locked-note", "where-web", "where-fallback", "where-texts", "english-body", "next", "approval-aside"].map((id) => out.indexOf(`data-testid="${id}"`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // It is the 960 px page, and there is no approval to make: no actions, no forms.
    expect(out).toContain('data-width="published"');
    expect(out).not.toContain("layout-screen__actions");
    expect(out).not.toContain("approve-form");
    expect(out).not.toContain('data-testid="facts"');
  });

  it("names the web languages in their own script and direction, and the languages that fell back", () => {
    const out = published({ fallback: ["ur"] });
    expect(out).toMatch(/<span lang="ps" dir="rtl" data-testid="where-web-languages-ps">/);
    expect(out).not.toContain('data-testid="where-web-languages-ur"');
    expect(out).toMatch(/<span lang="ur" dir="rtl" data-testid="where-fallback-languages-ur">/);
    expect(out).toContain("see the English text with &quot;Translation not available&quot; in their language.");
  });

  it("says the texts wait for texting to open, and lists the languages that have one ready", () => {
    const out = published();
    expect(out).toContain("Text sign-up is not open, so no text goes out now.");
    expect(out).toContain('data-testid="where-texts-languages-fr"');
    expect(out).not.toContain('data-testid="where-texts-languages-zh-Hant"');
  });

  it("links back to the incidents, and to the next update, and tells a drill apart", () => {
    const out = published();
    expect(out).toContain('<a class="tap hub-link hub-wrap" href="/staff" data-testid="next-home">Back to incidents</a>');
    expect(out).toContain('data-testid="next-promote"');
    const drill = published({ thread: { isDrill: true } });
    expect(drill).toContain('data-testid="published-drill"');
    expect(drill).toContain("Practice publish: nothing was sent to residents");
  });
});

describe("the notice that all texts are paused (S06.06)", () => {
  const NOTICE = "Texts are paused; this will send when resumed";
  const withNotice = (options: Parameters<typeof reviewOf>[0] = {}) => approvalScreen({ review: reviewOf(options), plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER, pauseNotice: NOTICE });

  it("is shown on the approval view as a note, above the text, and the actions are exactly what they were", () => {
    const out = html(withNotice());
    expect(out).toMatch(/<p role="note" class="hub-flag" data-testid="pause-notice">Texts are paused; this will send when resumed<\/p>/);
    expect(out.indexOf('data-testid="pause-notice"')).toBeLessThan(out.indexOf('data-testid="english-body"'));
    // Approve is as available as ever: the pause informs and refuses nothing.
    expect(region(out)).toContain('data-testid="approve-button"');
    expect(region(out)).not.toContain("disabled");
  });

  it("is shown on the confirmation of an approval, after what became of the entry", () => {
    const out = html(withNotice({ entry: { status: "approved" } }));
    expect(out).toContain("This alert was approved and is published.");
    expect(out).toContain('data-testid="pause-notice"');
    expect(out.indexOf('data-testid="locked-note"')).toBeLessThan(out.indexOf('data-testid="pause-notice"'));
  });

  it("is nothing when the notice is null: no note, no empty line", () => {
    expect(html(screenOf())).not.toContain("pause-notice");
    expect(html(screenOf({ entry: { status: "approved" } }))).not.toContain("pause-notice");
  });
});
