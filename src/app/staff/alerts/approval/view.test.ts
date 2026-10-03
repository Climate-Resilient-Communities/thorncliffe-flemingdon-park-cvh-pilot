import { describe, expect, it } from "vitest";
import { decodeCounts } from "@/contracts/alertApproval";
import { ALERT, APPROVER, AUTHOR, ENGLISH, ENTRY, HASH, OTHER_ALERT, OTHER_ENTRY, PLANS, reviewOf } from "../../../../../test/helpers/approvalReview";
import { APPROVAL_MESSAGE_CODES, approvalScreen, catalogText, countChangedView, formatCents, missingApproval, type ApprovalInput, type ApprovalScreen } from "./view";

const PRICE = 1.5;
const screenOf = (options: Parameters<typeof reviewOf>[0] = {}, extra: Partial<ApprovalInput> = {}): ApprovalScreen =>
  approvalScreen({ review: reviewOf(options), plans: PLANS, pricePerSegmentCents: PRICE, viewerId: APPROVER, ...extra });

describe("the approval view of an alert waiting for a second person (O-05)", () => {
  const screen = screenOf();

  it("is the approval of an alert, in the review state, with the entry it is about and where it loads again from", () => {
    expect(screen).toMatchObject({ variant: "alert", status: "review", title: "Approve an alert", ref: { alertId: ALERT, entryId: ENTRY }, here: `/staff/alerts/approve?alert=${ALERT}&entry=${ENTRY}` });
    expect(screen.locked).toBeUndefined();
  });

  it("puts the English text, the audience in words, the channels, the recipient count, the cost and the valid-until above the fold", () => {
    expect(screen.english).toEqual({ title: "The text (English)", body: ENGLISH });
    expect(screen.facts.audience.sentence).toBe("Residents of 4 Milepost Pl (floors 3, 4) and 85-95 Thorncliffe Park Dr (all floors).");
    expect(screen.facts.audience.groups).toContain("Seniors");
    expect(screen.facts.channels.items).toHaveLength(1);
    expect(screen.facts.recipients.count).toBe("0");
    expect(screen.facts.cost.label).toBe("Estimated cost:");
    expect(screen.facts.cost.note).toContain("estimate");
    // Toronto time: 2026-10-05T14:00Z is 10:00 in Toronto (daylight time).
    expect(screen.facts.validUntil.value).toContain("10:00");
    expect(screen.header.submitted).toMatch(/^Submitted .*10:00.*, version 2$/);
    expect(screen.header.types).toBe("Elevator, Power");
  });

  it("before E07 says that text sign-up is not open yet, counts 0 and lists the web only, with an estimate of $0.00", () => {
    expect(screen.facts.recipients).toMatchObject({ count: "0", notOpen: "Text sign-up is not open yet.", byLanguage: null });
    expect(screen.facts.channels.items).toEqual(["Web app, in every launch language."]);
    expect(screen.facts.cost.value).toBe("$0.00 CAD");
  });

  it("with texting open lists both channels, the people per language, and a cost of segments x recipients x the price, rounded up to the cent", () => {
    const open = screenOf({ recipients: { open: true, total: 5, byLanguage: { en: 3, ur: 2 } } });
    expect(open.facts.channels.items).toEqual(["Web app, in every launch language.", "Text messages, in the language of each person who signed up."]);
    expect(open.facts.recipients).toMatchObject({ count: "5", notOpen: null, byLanguage: { items: ["English: 3", "Urdu: 2"] } });
    // The English text is 2 segments and the Urdu one 4: (3 x 2 + 2 x 4) segments x 1.5 cents = 21 cents.
    expect(open.facts.cost.value).toBe("$0.21 CAD");
    // The reviewed count travels in the form and says the same.
    expect(decodeCounts(open.binding.reviewed)).toEqual({ total: 5, byLanguage: { en: 3, ur: 2 } });
  });

  it("says when a cost cannot be estimated (a language with people and no text message) instead of guessing", () => {
    const odd = screenOf({ recipients: { open: true, total: 1, byLanguage: { "zh-Hant": 1 } } });
    expect(odd.facts.cost.value).toBe("The cost cannot be estimated.");
  });

  it("names the version and hash that were shown, and the count reviewed, for every action to carry", () => {
    expect(screen.binding).toMatchObject({ version: 2, contentHash: HASH });
    expect(decodeCounts(screen.binding.reviewed)).toEqual({ total: 0, byLanguage: {} });
  });

  it("lists English and the fifteen other texts one tap away, each with its web text and text message as frozen; zh-Hant has no text message", () => {
    const rows = screen.languages.rows;
    expect(rows.map((row) => row.lang)).toEqual(["en", "ur", "ps", "tl", "prs", "gu", "ta", "el", "sk", "bn", "hi", "pa", "zh", "es", "fr", "zh-Hant"]);
    expect(rows[0]).toMatchObject({ lang: "en", web: null, state: "The text above" });
    expect(rows[0].sms?.body).toContain(ENGLISH);
    expect(rows[0].sms?.summary).toBe("Text message: 2 segment(s), standard characters");
    const urdu = rows.find((row) => row.lang === "ur")!;
    expect(urdu).toMatchObject({ native: "اردو", bcp47: "ur", dir: "rtl", english: "Urdu", state: "Machine translation" });
    expect(urdu.web).toContain("[ur]");
    expect(urdu.sms?.summary).toBe("Text message: 4 segment(s), special characters");
    const traditional = rows.find((row) => row.lang === "zh-Hant")!;
    expect(traditional).toMatchObject({ english: "Chinese (Traditional)", state: "Converted from Mandarin", sms: null });
    expect(screen.languages.lead).toContain("exactly as residents get them");
  });

  it("flags the languages that fell back above the fold, with how many, and says nothing of 'every language' then", () => {
    const fell = screenOf({ fallback: ["ur", "ps"] });
    expect(fell.fallback?.summary).toBe('2 of 15 languages could not be translated: Urdu and Pashto. They show the English text with "Translation not available".');
    expect(fell.allTranslated).toBeNull();
    expect(fell.languages.rows.filter((row) => row.fallback).map((row) => row.lang)).toEqual(["ur", "ps"]);
    expect(fell.languages.rows.find((row) => row.lang === "ur")!.state).toContain("Not translated");
    expect(screen.fallback).toBeNull();
    expect(screen.allTranslated).toBe("Every language was translated.");
  });

  it("says how many people get a fallback language's English text once texting is open", () => {
    const fell = screenOf({ fallback: ["ur"], recipients: { open: true, total: 4, byLanguage: { en: 1, ur: 3 } } });
    expect(fell.fallback?.recipients).toBe("In those languages 3 people will get the English text by text message.");
    expect(screenOf({ fallback: ["ur"] }).fallback?.recipients).toBeNull();
  });

  it("links to the possible duplicate (S04.05) and says so, and has no link when the other thread holds nothing to open", () => {
    const linked = screenOf({ duplicate: { alertId: OTHER_ALERT, entryId: OTHER_ENTRY } });
    expect(linked.duplicate).toEqual({
      text: "This may duplicate another open alert for the same place and type.",
      link: { href: `/staff/alerts/approve?alert=${OTHER_ALERT}&entry=${OTHER_ENTRY}`, label: "Open the other alert" },
    });
    expect(screenOf({ duplicate: { alertId: OTHER_ALERT, entryId: null } }).duplicate?.link).toBeNull();
    expect(screen.duplicate).toBeNull();
  });

  it("offers Approve, Return to author with a note and Discard, and no way to edit and approve", () => {
    expect(screen.actions).toEqual({ label: "Approval actions", approve: "Approve", approveConfirmed: "Confirm the new number and approve", returnToAuthor: "Return to author", discard: "Discard" });
    expect(screen.returnForm).toMatchObject({ noteLabel: "Note to the author", max: 500, send: "Send back with this note" });
    expect(screen.cannotEdit).toContain("You cannot change this text");
    expect(screen.cannotEdit).toContain("return it to its author with a note");
    const words = JSON.stringify({ actions: screen.actions, returnForm: screen.returnForm, discardForm: screen.discardForm });
    expect(words.toLowerCase()).not.toMatch(/edit and approve|approve and edit|edit/);
  });

  it("marks a drill, and does not mark a real alert", () => {
    expect(screenOf({ thread: { isDrill: true } }).header.drill).toBe("This is a drill. It never reaches residents.");
    expect(screen.header.drill).toBeNull();
  });

  it("lists no resident channel for a drill, whether or not texting is open, so the channels never contradict 'It never reaches residents'", () => {
    const drill = ["The drill roster only. A drill is never shown on the web app or texted to residents."];
    expect(screenOf({ thread: { isDrill: true } }).facts.channels.items).toEqual(drill);
    expect(screenOf({ thread: { isDrill: true }, recipients: { open: true, total: 2, byLanguage: { en: 2 } } }).facts.channels.items).toEqual(drill);
    expect(screen.facts.channels.items).toEqual(["Web app, in every launch language."]);
  });

  it("has its own words for every refusal an approval, a return or a discard can end with", () => {
    const messages = APPROVAL_MESSAGE_CODES.map((code) => screen.messages.errors[code]);
    for (const message of messages) expect(message).not.toBe(screen.messages.errors.invalid);
    expect(screen.messages.errors.ENTRY_CHANGED).toBe("This alert changed. Review it again.");
    expect(screen.messages.errors.VALID_UNTIL_PAST).toContain("This alert's valid-until has passed");
    expect(screen.messages.errors.VALID_UNTIL_PAST).toContain("return it to draft and set a new time");
    expect(screen.messages.errors.NOTE_TOO_LONG).toContain("500");
  });
});

describe("the approval view of an ambassador's post (O-07)", () => {
  const screen = screenOf({ authorRole: "ambassador" });

  it("is the review of an ambassador post, saying so and how residents see it, with the same three actions", () => {
    expect(screen).toMatchObject({ variant: "ambassador", status: "review", title: "Review an ambassador post" });
    expect(screen.header.by).toBe("Written by a building ambassador. Residents see it as from a building ambassador.");
    expect(screen.lead).toContain("A building ambassador wrote this post");
    expect(screen.actions).toMatchObject({ approve: "Approve", returnToAuthor: "Return to author", discard: "Discard" });
  });

  it("has no edit action either: the Hub's own words (Approve, Return, Discard) replace the prototype's 'Edit' and 'Decline'", () => {
    expect(JSON.stringify({ actions: screen.actions, forms: [screen.returnForm, screen.discardForm] }).toLowerCase()).not.toMatch(/edit|decline/);
    expect(screen.cannotEdit).toContain("return it to its author with a note");
  });

  it("is an alert's view for any other author, with no ambassador line", () => {
    for (const role of ["coordinator", "admin", null] as const) {
      const other = screenOf({ authorRole: role });
      expect(other.variant).toBe("alert");
      expect(other.header.by).toBeNull();
    }
  });
});

describe("an entry that is not waiting for this person", () => {
  it.each([
    ["approved", { status: "approved" as const }, "This alert was approved and is published."],
    ["discarded", { status: "discarded" as const }, "This alert was discarded."],
    ["a draft its author pulled back", { status: "draft" as const, contentHash: null, submittedAt: null }, "Its author pulled it back to a draft, so it is not waiting for approval."],
    ["superseded", { status: "superseded" as const }, "This alert is not waiting for approval."],
  ])("says what became of %s, and offers no action", (_name, entry, message) => {
    const screen = screenOf({ entry });
    expect(screen).toMatchObject({ status: "locked", locked: { message } });
  });

  it("says an entry the person wrote or changed needs a second person", () => {
    const own = approvalScreen({ review: reviewOf(), plans: PLANS, pricePerSegmentCents: PRICE, viewerId: AUTHOR });
    expect(own).toMatchObject({ status: "locked", locked: { message: "You wrote or changed this alert, so a second person has to approve it." } });
    const edited = approvalScreen({ review: reviewOf({ entry: { editorIds: [AUTHOR, APPROVER] } }), plans: PLANS, pricePerSegmentCents: PRICE, viewerId: APPROVER });
    expect(edited.status).toBe("locked");
  });

  it("shows the note an approver sent back with, on the draft it returned", () => {
    const returned = screenOf({ entry: { status: "draft", contentHash: null, submittedAt: null, returnedFor: "return", returnedNote: "Say which floors." } });
    expect(returned.locked).toEqual({ message: "This alert was sent back to its author with a note, and is waiting for the author to submit it again.", note: "The note sent: Say which floors." });
  });

  it("says a closed thread's pending entry is closed", () => {
    expect(screenOf({ thread: { status: "closed" } }).locked?.message).toBe("This alert is closed.");
  });

  it("still shows what the entry says and what went out, for the approver who opens it later", () => {
    const approved = screenOf({ entry: { status: "approved" } });
    expect(approved.english.body).toBe(ENGLISH);
    expect(approved.languages.rows).toHaveLength(16);
  });
});

describe("the count an approval was refused for", () => {
  const review = reviewOf({ recipients: { open: true, total: 5, byLanguage: { en: 3, ur: 2 } } });

  it("says from what to what, lists the new number per language with its cost, and carries the new count for the next Approve to name", () => {
    const view = countChangedView({ review, snapshot: { total: 7, byLanguage: { en: 3, ur: 4 } }, reviewed: { total: 5, byLanguage: { en: 3, ur: 2 } }, pricePerSegmentCents: PRICE });
    expect(view.message).toBe("The number of people who will get this text changed from 5 to 7");
    expect(view.rows).toEqual([
      { lang: "en", english: "English", n: 3 },
      { lang: "ur", english: "Urdu", n: 4 },
    ]);
    // (3 x 2 + 4 x 4) segments x 1.5 cents = 33 cents.
    expect(view.cost).toBe("Estimated cost now: $0.33 CAD (an estimate)");
    expect(decodeCounts(view.reviewed)).toEqual({ total: 7, byLanguage: { en: 3, ur: 4 } });
    expect(view.confirm).toBe("I have read the new number and I still want to approve.");
  });

  it("says the languages changed when the total did not (people moved from one language to another)", () => {
    const view = countChangedView({ review, snapshot: { total: 5, byLanguage: { en: 4, ur: 1 } }, reviewed: { total: 5, byLanguage: { en: 3, ur: 2 } }, pricePerSegmentCents: PRICE });
    expect(view.message).toBe("The languages of the people who will get this text changed");
  });

  it("leaves out a language nobody is left in, and says when the cost cannot be estimated", () => {
    const view = countChangedView({ review, snapshot: { total: 2, byLanguage: { en: 2 } }, reviewed: { total: 5, byLanguage: { en: 3, ur: 2 } }, pricePerSegmentCents: PRICE });
    expect(view.rows).toEqual([{ lang: "en", english: "English", n: 2 }]);
    const none = countChangedView({ review: reviewOf({ entry: { status: "draft" } }), snapshot: { total: 1, byLanguage: { en: 1 } }, reviewed: { total: 0, byLanguage: {} }, pricePerSegmentCents: PRICE });
    expect(none.cost).toBe("The cost cannot be estimated.");
  });
});

describe("the words and the helpers", () => {
  it("writes whole cents as dollars", () => {
    expect([0, 1, 21, 150, 12345].map(formatCents)).toEqual(["$0.00", "$0.01", "$0.21", "$1.50", "$123.45"]);
  });

  it("takes every word from the catalog's staff.approve group, and the screen for a missing entry says so", () => {
    expect(catalogText("title")).toBe("Approve an alert");
    expect(missingApproval()).toEqual({ kind: "missing", message: "That alert was not found. Open it again from the Hub.", back: { href: "/staff", label: "Back to the Hub" } });
  });

  it("puts a given set of words in every place, so a longer label shows up everywhere (the layout tests)", () => {
    const long = (key: string) => `LONG(${key})`;
    const screen = screenOf({}, { text: long });
    expect(screen.title).toBe("LONG(title)");
    expect(screen.facts.cost.label).toBe("LONG(cost)");
    expect(screen.languages.rows[1].english).toBe("LONG(languageNames.ur)");
    expect(screen.actions.approve).toBe("LONG(approve)");
    expect(screen.returnForm.counter).toBe("LONG(noteCounter)");
    expect(screen.facts.audience.sentence).toBe("LONG(buildingsSentence)");
  });
});
