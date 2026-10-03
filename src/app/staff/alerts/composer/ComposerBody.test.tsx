import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EntryState } from "@/modules/alerting";
import type { BuildingFloorPlan } from "@/modules/places";
import { ComposerBody, type ComposerActions } from "./ComposerBody";
import { composerScreen, type ComposerInput, type ComposerScreen } from "./view";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const OTHER = "01900000-0000-7000-8000-00000000e178";
const KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";
const NOW = new Date("2026-10-04T14:00:00.000Z");

const PLANS: BuildingFloorPlan[] = [{ rsn: "7001", address: "45 Thorncliffe Park Dr", neighbourhoodId: "TP", neighbourhoodName: "Thorncliffe Park", floors: [] }];
const noop = async () => ({ status: "idle" as const });
const actions: ComposerActions = { save: noop, pullBack: noop };

function stateOf(entry: Record<string, unknown> = {}, attempt: Record<string, unknown> | null = null, translations: EntryState["translations"] = [], types = ["elevator"]): EntryState {
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
    entry: {
      id: ENTRY,
      alertId: ALERT,
      kind: "ack",
      status: "draft",
      authorId: "01900000-0000-7000-8000-0000000000c1",
      editorIds: [],
      content: {
        text: "The elevator is out.",
        types,
        audience: { scope: "buildings", buildings: [{ rsn: "7001", floors: null }], groups: [], types },
        phase: "problem",
        validUntil: new Date("2026-10-05T14:00:00.000Z"),
      },
      version: 0,
      contentHash: null,
      submittedAt: null,
      returnedFor: null,
      approvedBy: null,
      approvedAt: null,
      webPublishedAt: null,
      possibleDuplicateOf: null,
      ...entry,
    } as EntryState["entry"],
    attempt:
      attempt === null
        ? null
        : ({ key: KEY, kind: "submit", state: "running", outcome: null, startedAt: NOW, finishedAt: null, budgetMs: 35000, progress: {}, resultVersion: null, resultHash: null, ...attempt } as NonNullable<EntryState["attempt"]>),
    translations,
  };
}

const screenOf = (state: EntryState, mode: ComposerInput["mode"] = "ack"): ComposerScreen =>
  composerScreen({ mode, state, plans: PLANS, preview: { sms: { body: "Hub: The elevator is out.", encoding: "gsm7", segments: 1 }, nineOneOneFirst: false }, saved: false, now: NOW });
const html = (screen: ComposerScreen, initial?: Parameters<typeof ComposerBody>[0]["initial"]) => renderToStaticMarkup(<ComposerBody screen={screen} actions={actions} initial={initial} />);

const FROZEN: EntryState["translations"] = [
  { lang: "fr", status: "translated", machine: true },
  { lang: "ur", status: "fallback_en", machine: false },
];
const pendingState = (translations = FROZEN, entry: Record<string, unknown> = {}) => stateOf({ status: "pending_approval", version: 2, contentHash: "e".repeat(64), ...entry }, { state: "committed", resultVersion: 2, finishedAt: NOW }, translations);

describe("the acknowledgement composer, a draft (O-12)", () => {
  const out = html(screenOf(stateOf()));

  it("has the text in a labelled textarea with its counter, and the valid-until choices", () => {
    expect(out).toContain("<h1>Acknowledge the disruption</h1>");
    expect(out).toMatch(/<textarea[^>]*id="composer-text"[^>]*>The elevator is out\.<\/textarea>/);
    expect(out).toContain('for="composer-text"');
    expect(out).toContain('data-testid="composer-count"');
    expect(out).toContain('name="valid-mode"');
    expect(out).toContain('name="valid-date"');
    expect(out).toContain('name="valid-time"');
    expect(out).toContain('value="2026-10-05"');
    expect(out).toContain('value="10:00"');
  });

  it("shows the types as words, not as choices, and has no phase choice", () => {
    expect(out).toContain('data-testid="types-summary"');
    expect(out).not.toContain('name="type"');
    expect(out).not.toContain('name="phase"');
  });

  it("carries the draft in hidden fields and puts Save draft and Submit for approval in the actions region", () => {
    expect(out).toContain(`<input type="hidden" name="alert" value="${ALERT}"/>`);
    expect(out).toContain(`<input type="hidden" name="entry" value="${ENTRY}"/>`);
    const region = out.slice(out.indexOf('class="layout-screen__actions"'));
    expect(region).toContain('data-testid="save-draft"');
    expect(region).toContain('data-testid="submit-button"');
    expect(region).toContain("Save draft");
    expect(region).toContain("Submit for approval");
    // Save is a submit button of the form; Submit is a plain button that runs the press.
    expect(region).toMatch(/<button[^>]*type="submit"[^>]*form="composer-form"[^>]*data-testid="save-draft"/);
    expect(region).toMatch(/<button[^>]*type="button"[^>]*data-testid="submit-button"/);
    expect(out.match(/<form /g)).toHaveLength(1);
  });

  it("lists the fifteen texts as waiting, previews the English text message and says who gets it", () => {
    expect(out.match(/data-testid="language-[A-Za-z-]+"/g)).toHaveLength(15);
    expect(out.match(/data-state="waiting"/g)).toHaveLength(15);
    expect(out).toContain("Translated when you submit");
    expect(out).toContain('data-testid="sms-preview"');
    expect(out).toContain("Hub: The elevator is out.");
    expect(out).toContain('data-testid="audience-sentence"');
    expect(out).toContain("45 Thorncliffe Park Dr");
  });

  it("uses the Hub's two columns, the main content first and the aside after it", () => {
    expect(out).toContain('class="layout-grid" data-two-column="aside"');
    expect(out.indexOf('data-testid="languages"')).toBeLessThan(out.indexOf('data-testid="composer-aside"'));
  });

  it("links the place and the groups pages from the aside, with the way back", () => {
    expect(out).toContain(`href="/staff/alerts/audience?alert=${ALERT}&amp;entry=${ENTRY}&amp;from=ack"`);
    expect(out).toContain(`href="/staff/alerts/audience/groups?alert=${ALERT}&amp;entry=${ENTRY}&amp;from=ack"`);
  });

  it("shows nothing is running and no failure", () => {
    expect(out).not.toContain('data-testid="submit-panel"');
    expect(out).not.toContain('role="alert"');
  });

  it("uses the Hub's controls only: every checkbox and radio is a .hub-choice, every field a .hub-input", () => {
    const controls = out.match(/<input type="(?:checkbox|radio)"/g)?.length ?? 0;
    expect(out.match(/<label class="hub-choice"><input type="(?:checkbox|radio)"/g)?.length ?? 0).toBe(controls);
    expect(out).toMatch(/<textarea [^>]*class="hub-input"/);
    const fields = out.match(/<input [^>]*type="(?:date|time)"[^>]*>/g) ?? [];
    expect(fields).toHaveLength(2);
    for (const tag of fields) expect(tag).toContain('class="hub-input"');
  });
});

describe("the alert composer, a draft (O-02)", () => {
  const out = html(screenOf(stateOf({ kind: "update" }, null, [], ["power", "elevator"]), "alert"));

  it("has the types and where things stand as the Hub's choices, with the entry's own ticked", () => {
    expect(out).toContain("<h1>Write an alert</h1>");
    expect(out).toContain('name="types-sent"');
    expect(out.match(/name="type"/g)).toHaveLength(9);
    const ticked = (value: string) => (out.match(/<input [^>]*name="type"[^>]*>/g) ?? []).find((tag) => tag.includes(`value="${value}"`))?.includes(' checked=""');
    expect(ticked("power")).toBe(true);
    expect(ticked("elevator")).toBe(true);
    expect(ticked("heat")).toBe(false);
    expect(out.match(/name="phase"/g)).toHaveLength(2);
    expect(out).not.toContain('data-testid="types-summary"');
  });

  it("links back to this composer from the audience pages", () => {
    expect(out).toContain("from=compose");
  });
});

describe("a draft that is being submitted", () => {
  const screen = screenOf(stateOf({}, { state: "running", progress: { fr: "translated", ur: "fallback_en" } }));
  const out = html(screen);

  it("shows the running panel, with how many languages are done of how many, and each language as it settled", () => {
    expect(out).toContain('data-testid="submit-panel"');
    expect(out).toContain("Preparing your alert");
    expect(out).toContain("up to 35 seconds");
    expect(out).toContain('data-testid="progress-summary">2 of 15 languages done');
    expect(out).toMatch(/data-testid="language-fr" data-state="translated"/);
    expect(out).toMatch(/data-testid="language-ur" data-state="fallback_en"/);
    expect(out).toMatch(/data-testid="language-ta" data-state="waiting"/);
  });

  it("disables both buttons so a second press cannot start another attempt", () => {
    expect(out).toMatch(/<button[^>]*data-testid="save-draft"[^>]*disabled=""|<button[^>]*disabled=""[^>]*data-testid="save-draft"/);
    expect(out).toMatch(/<button[^>]*data-testid="submit-button"[^>]*disabled=""|<button[^>]*disabled=""[^>]*data-testid="submit-button"/);
  });

  it("says it can take up to a minute when the budget is not known yet", () => {
    const unknown = html(screenOf(stateOf({}, { state: "running", budgetMs: null })));
    expect(unknown).toContain("This can take up to a minute");
  });

  it("does not poll or say the connection was lost until a press is lost", () => {
    expect(out).not.toContain('data-testid="lost-note"');
  });
});

describe("a draft whose last attempt failed", () => {
  it("says why, in words, with the draft and its text kept", () => {
    const out = html(screenOf(stateOf({}, { state: "failed", outcome: "ROUTES_UNAVAILABLE", finishedAt: NOW })));
    expect(out).toContain('role="alert"');
    expect(out).toContain("The translation settings could not be read");
    expect(out).toContain("The elevator is out.");
    expect(out).toContain('data-testid="submit-button"');
  });
});

describe("a draft after a refusal", () => {
  it("says why next to the form and keeps what was typed", () => {
    const out = html(screenOf(stateOf()), { save: { status: "refused", message: "The text is too long: at most 600 characters." } });
    expect(out).toContain('id="composer-error"');
    expect(out).toContain("The text is too long");
    expect(out).toMatch(/aria-describedby="composer-text-hint composer-text-count composer-error"/);
  });

  it("asks before or after, with the two readings as radios and no answer chosen, when the valid-until is in the repeated hour", () => {
    const out = html(screenOf(stateOf()), { save: { status: "ask", question: "1:30 a.m. happens twice on Sunday, November 1.", before: "Before the clock change (1:30 a.m. EDT)", after: "After the clock change (1:30 a.m. EST)" } });
    expect(out).toContain('data-testid="fold-question"');
    expect(out).toContain("happens twice");
    const radios = out.match(/<input [^>]*name="valid-fold"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios.some((tag) => tag.includes('value="before"') && tag.includes("required"))).toBe(true);
    expect(radios.every((tag) => !tag.includes('checked=""'))).toBe(true);
  });
});

describe("a submitted entry", () => {
  it("shows what was frozen and has Pull back to edit, with no form to change the text", () => {
    const out = html(screenOf(pendingState()));
    expect(out).toContain('data-testid="pending-panel"');
    expect(out).toContain("Submitted for approval");
    expect(out).toContain("Version 2");
    expect(out).not.toContain('data-testid="composer-text"');
    expect(out).not.toContain('data-testid="sms-preview"');
    const region = out.slice(out.indexOf('class="layout-screen__actions"'));
    expect(region).toContain('data-testid="pull-back"');
    expect(region).toMatch(/<button[^>]*type="submit"[^>]*form="pull-back-form"/);
    expect(out).toContain('id="pull-back-form"');
    // The place and group pages are links only for a draft.
    expect(out).not.toContain("/staff/alerts/audience?");
  });

  it("names the languages that fell back and offers Try translation again", () => {
    const out = html(screenOf(pendingState()));
    expect(out).toContain('data-testid="fallback-summary"');
    expect(out).toContain("1 of 15 languages could not be translated");
    expect(out).toContain("Urdu");
    expect(out).toContain('data-testid="retry-translation"');
    expect(out).toContain("Try translation again");
    expect(out).toMatch(/data-testid="language-ur" data-state="fallback_en"/);
    expect(out).toMatch(/data-testid="language-fr" data-state="translated"/);
  });

  it("says every language was translated and offers no retry when none fell back", () => {
    const out = html(screenOf(pendingState([{ lang: "fr", status: "translated", machine: true }])));
    expect(out).toContain('data-testid="all-translated"');
    expect(out).not.toContain('data-testid="retry-translation"');
    expect(out).not.toContain('data-testid="fallback-summary"');
  });

  it("shows the possible duplicate only when there is one", () => {
    expect(html(screenOf(pendingState(FROZEN, { possibleDuplicateOf: OTHER })))).toContain('data-testid="duplicate-note"');
    expect(html(screenOf(pendingState()))).not.toContain('data-testid="duplicate-note"');
  });
});

describe("an entry that can no longer be changed here", () => {
  it("says so, with no form and no actions region", () => {
    const out = html(screenOf(stateOf({ status: "approved", version: 1, contentHash: "f".repeat(64) }, null, FROZEN)));
    expect(out).toContain('data-testid="locked-note"');
    expect(out).toContain("approved and is published");
    expect(out).not.toContain("<form");
    expect(out).not.toContain('class="layout-screen__actions"');
  });
});
