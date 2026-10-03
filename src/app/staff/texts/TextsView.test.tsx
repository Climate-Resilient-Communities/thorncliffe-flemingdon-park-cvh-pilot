import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { englishText } from "@/i18n/text";
import type { PausedStatus } from "@/modules/messaging";
import type { TextsState } from "./control";
import { PauseTextsFormView, latestAnswer, type PauseTextsLabels } from "./PauseTextsFormView";
import { TextsView } from "./TextsView";
import { pausedView } from "./view";

const labels: PauseTextsLabels = {
  reason: englishText("staff.texts.reason"),
  reasonHint: englishText("staff.texts.reasonHint"),
  pause: englishText("staff.texts.pause"),
  pausing: englishText("staff.texts.pausing"),
  resume: englishText("staff.texts.resume"),
  resuming: englishText("staff.texts.resuming"),
  resumeHint: englishText("staff.texts.resumeHint"),
};
const IDLE: TextsState = { status: "idle" };
const status = (over: Partial<PausedStatus> = {}): PausedStatus => ({
  paused: true,
  pausedBy: "01900000-0000-7000-8000-0000000000a1",
  pausedAt: new Date("2026-10-05T18:15:00Z"),
  reason: "Wrong alert sent to Thorncliffe Park",
  handedOffAtPause: 3,
  ...over,
});
const form = (paused: boolean, answer: TextsState = IDLE) => <PauseTextsFormView paused={paused} labels={labels} reasonMaxLength={500} answer={answer} />;

describe("the Pause texts page while texts are going out", () => {
  const html = renderToStaticMarkup(<TextsView paused={null} form={form(false)} />);

  it("says texts are going out as normal and what pausing does", () => {
    expect(html).toContain("Pause or resume texts");
    expect(html).toContain("Texts are going out as normal.");
    expect(html).toContain("Pausing stops every alert and every text to residents that has not yet been handed to the provider.");
  });

  it("says that texts to on-call Admins continue during a pause", () => {
    expect(html).toContain("Texts to on-call Admins still go out during a pause, so a problem with sending is still reported.");
  });

  it("offers 'Pause all texts' with a required reason of at most 500 characters, and no resume", () => {
    expect(html).toMatch(/<textarea[^>]*name="reason"[^>]*required=""[^>]*maxLength="500"|<textarea[^>]*maxLength="500"[^>]*required=""/);
    expect(html).toContain("Why are you pausing texts?");
    expect(html).toContain("Everyone at the Hub sees this on every screen");
    expect(html).toContain("Pause all texts");
    expect(html).not.toContain("Resume texts");
  });
});

describe("the Pause texts page while texts are paused", () => {
  const html = renderToStaticMarkup(<TextsView paused={pausedView(status(), "Ann Okafor")} form={form(true)} />);

  it("says 'Texts are paused' with who paused, when and why", () => {
    expect(html).toContain("Texts are paused");
    expect(html).toContain("Paused by Ann Okafor on Oct 5, 2026, 2:15 p.m.");
    expect(html).toContain("Why: Wrong alert sent to Thorncliffe Park");
  });

  it("says how many texts were already handed to the provider and cannot be recalled", () => {
    expect(html).toContain("3 texts were already handed to the provider and cannot be recalled");
  });

  it("says nothing of handed-off texts when none had gone", () => {
    const quiet = renderToStaticMarkup(<TextsView paused={pausedView(status({ handedOffAtPause: 0 }), "Ann")} form={form(true)} />);

    expect(quiet).not.toContain("already handed to the provider");
  });

  it("says that texts to on-call Admins continue during the pause", () => {
    expect(html).toContain("Texts to on-call Admins still go out during a pause");
  });

  it("offers 'Resume texts' and what resuming checks, and no reason field", () => {
    expect(html).toContain("Resume texts");
    expect(html).toContain("Each one is checked once more just before it is handed over");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Pause all texts");
  });
});

describe("the Pause texts page when the switch cannot be read", () => {
  it("says so as an alert and still offers to pause, since pausing what is already paused changes nothing", () => {
    const html = renderToStaticMarkup(<TextsView paused={null} unreadable form={form(false)} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("The Hub could not read whether texts are paused.");
    expect(html).not.toContain("Texts are going out as normal.");
    expect(html).toContain("Pause all texts");
  });
});

describe("the controls' answers", () => {
  it("lists what a press did, in a live region that is always in the page", () => {
    const answer: TextsState = { status: "done", at: 1, lines: ["Texts are paused.", "12 texts are waiting and will go out when you resume."] };

    const html = renderToStaticMarkup(form(true, answer));

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("<p>Texts are paused.</p>");
    expect(html).toContain("12 texts are waiting and will go out when you resume.");
    expect(renderToStaticMarkup(form(false))).toContain('aria-live="polite"');
  });

  it("shows a refusal as an alert in the Hub's error style, tied to the reason field", () => {
    const answer: TextsState = { status: "refused", at: 1, message: "Say why you are pausing texts." };

    const html = renderToStaticMarkup(form(false, answer));

    expect(html).toContain('role="alert"');
    expect(html).toContain('class="hub-error"');
    expect(html).toContain("Say why you are pausing texts.");
    expect(html).toMatch(/aria-describedby="texts-reason-hint texts-error"/);
  });

  it("disables the button while a press is under way, and says what it is doing", () => {
    const pausing = renderToStaticMarkup(<PauseTextsFormView paused={false} labels={labels} reasonMaxLength={500} answer={IDLE} pausing />);
    const resuming = renderToStaticMarkup(<PauseTextsFormView paused labels={labels} reasonMaxLength={500} answer={IDLE} resuming />);

    expect(pausing).toMatch(/<button[^>]*disabled=""[^>]*>Pausing texts<\/button>/);
    expect(resuming).toMatch(/<button[^>]*disabled=""[^>]*>Resuming texts<\/button>/);
  });
});

describe("which answer the page shows", () => {
  const done = (at: number): TextsState => ({ status: "done", at, lines: [`at ${at}`] });

  it("is the later of the two buttons' answers, so an old answer of the other button is never shown", () => {
    expect(latestAnswer(done(1), done(2))).toEqual(done(2));
    expect(latestAnswer(done(5), done(2))).toEqual(done(5));
    expect(latestAnswer({ status: "refused", at: 9, message: "no" }, done(2))).toEqual({ status: "refused", at: 9, message: "no" });
  });

  it("is the other's when one has not been pressed, and nothing when neither has", () => {
    expect(latestAnswer(IDLE, done(2))).toEqual(done(2));
    expect(latestAnswer(done(2), IDLE)).toEqual(done(2));
    expect(latestAnswer(IDLE, IDLE)).toEqual(IDLE);
  });
});
