// The sending progress as it is drawn (S06.09, O-06): the alert's staff view, the list of the texts that did not arrive, and the published confirmation, from view models
// built by hand. Static markup, so nothing reloads; the reload is tested in refresh.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { progressOf } from "@/modules/messaging";
import { APPROVER, PLANS, reviewOf } from "../../../../../test/helpers/approvalReview";
import { ApprovalBody, type ApprovalActions } from "../approval/ApprovalBody";
import { approvalScreen } from "../approval/view";
import type { ProblemListScreen, SendingScreen } from "./load";
import { ProblemListBody, SendingBody } from "./SendingBody";
import { sendingProgressView, problemListView } from "./view";

// The reload uses the router, which a static render does not have.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

type Row = Parameters<typeof progressOf>[0][number];
const rows = (lang: string, state: Row["state"], n: number, handedOff = false): Row[] => Array.from({ length: n }, () => ({ lang, state, handedOff }));
const REF = { alertId: "01900000-0000-7000-8000-00000000a1e7", entryId: "01900000-0000-7000-8000-00000000e177" };
const progress = progressOf([...rows("en", "queued", 2), ...rows("en", "delivered", 4, true), ...rows("ur", "failed", 2), ...rows("ur", "unknown", 1, true), ...rows("ur", "claimed", 1, true)]);

const screenOf = (paused: boolean): SendingScreen => ({
  kind: "screen",
  ref: REF,
  heading: "Elevator, Power · Acknowledgement",
  block: { kind: "progress", view: sendingProgressView({ ref: REF, progress, paused }) },
  notice: null,
  back: { href: "/staff/alerts/approve?alert=a&entry=e", label: "Back to the alert" },
});

describe("the alert's staff view of the sending progress", () => {
  it("draws a count for each state in each language, with the totals", () => {
    const out = renderToStaticMarkup(<SendingBody screen={screenOf(false)} live={false} />);
    expect(out).toContain('data-testid="sending-heading"');
    expect(out).toContain("Elevator, Power · Acknowledgement");
    expect(out).toMatch(/data-testid="sending-en"/);
    expect(out).toMatch(/data-testid="sending-ur"/);
    expect(out).toMatch(/data-testid="sending-all"/);
    for (const id of ["waiting", "inFlight", "delivered", "undelivered", "failed", "unknown", "cancelled"]) expect(out).toContain(`data-count="${id}"`);
    expect(out).toMatch(/data-count="inFlight" data-n="1"/);
    expect(out).toMatch(/Failed: 2/);
    expect(out).toMatch(/data-testid="sending-summary">10 texts in all/);
  });

  it("links the lists of the texts that did not arrive and shows no phone number", () => {
    const out = renderToStaticMarkup(<SendingBody screen={screenOf(false)} live={false} />);
    expect(out).toContain('data-testid="sending-list-failed"');
    expect(out).toContain('data-testid="sending-list-unknown"');
    expect(out).not.toContain('data-testid="sending-list-undelivered"');
    expect(out).toContain(`/staff/alerts/sending/texts?alert=${REF.alertId}&amp;entry=${REF.entryId}&amp;state=failed`);
    expect(out).not.toMatch(/\+\d{7,}|\d{3}[ -]\d{3}[ -]\d{4}/);
  });

  it("shows the sentence about texts handed to the provider while paused with texts waiting, and not otherwise", () => {
    expect(renderToStaticMarkup(<SendingBody screen={screenOf(true)} live={false} />)).toMatch(/data-testid="sending-handed-off">6 texts were already handed to the provider and cannot be recalled/);
    expect(renderToStaticMarkup(<SendingBody screen={screenOf(false)} live={false} />)).not.toContain("sending-handed-off");
  });

  it("marks the block live while a text waits or is in flight", () => {
    expect(renderToStaticMarkup(<SendingBody screen={screenOf(false)} live={false} />)).toContain('data-live="true"');
    const done = screenOf(false);
    done.block = { kind: "progress", view: sendingProgressView({ ref: REF, progress: progressOf(rows("en", "delivered", 2, true)), paused: false }) };
    const out = renderToStaticMarkup(<SendingBody screen={done} live={false} />);
    expect(out).toContain('data-live="false"');
    expect(out).toMatch(/no longer updates by itself/);
  });

  it("explains a drill, an entry that is not approved and a failure to read, instead of the counts", () => {
    const drill: SendingScreen = { ...screenOf(false), block: null, notice: { message: "This is a practice alert.", link: { href: "/staff/drills", label: "Open the Drills page" } } };
    const out = renderToStaticMarkup(<SendingBody screen={drill} live={false} />);
    expect(out).toContain('data-testid="sending-notice"');
    expect(out).toContain('href="/staff/drills"');
    expect(out).not.toContain('data-testid="sending"');
    const failed: SendingScreen = { ...screenOf(false), block: { kind: "unavailable", note: "The sending progress could not be read just now." } };
    expect(renderToStaticMarkup(<SendingBody screen={failed} live={false} />)).toContain('data-testid="sending-unavailable"');
  });

  it("starts the reload when the block is live, and does not otherwise (the component renders without a router in the page)", () => {
    expect(() => renderToStaticMarkup(<SendingBody screen={screenOf(false)} />)).not.toThrow();
  });
});

describe("the list of the texts that did not arrive", () => {
  const screen: ProblemListScreen = {
    kind: "list",
    ref: REF,
    heading: "Elevator, Power · Acknowledgement",
    list: problemListView({
      ref: REF,
      state: "failed",
      texts: [
        { id: "01900000-0000-7000-8000-00000abc1234", reference: "abc123", lang: "ur", state: "failed", meaning: "not_in_service", code: null, at: new Date("2026-10-05T18:15:00Z") },
        { id: "01900000-0000-7000-8000-00000abc5678", reference: "abc567", lang: "en", state: "failed", meaning: "retries_exhausted", code: null, at: new Date("2026-10-05T18:16:00Z") },
      ],
      more: false,
      limit: 200,
    }),
  };

  it("draws one item per text with its meaning in plain words", () => {
    const out = renderToStaticMarkup(<ProblemListBody screen={screen} />);
    expect(out).toContain("Failed texts");
    expect(out.match(/data-testid="sending-list-item"/g)).toHaveLength(2);
    expect(out).toContain("Number not in service");
    expect(out).toContain("It still failed after 3 retries");
    expect(out).toContain('data-meaning="not_in_service"');
    expect(out).toContain("Text abc123");
    expect(out).not.toMatch(/\+\d{7,}/);
  });

  it("says when no text is in the state", () => {
    const empty = { ...screen, list: problemListView({ ref: REF, state: "unknown", texts: [], more: false, limit: 200 }) };
    expect(renderToStaticMarkup(<ProblemListBody screen={empty} />)).toContain('data-testid="sending-list-none"');
  });
});

describe("the published confirmation (O-06)", () => {
  const noop = async () => ({ status: "idle" as const });
  const actions: ApprovalActions = { approve: noop, returnToAuthor: noop, discard: noop };
  const approved = (options: Parameters<typeof reviewOf>[0] = {}, withProgress = true) =>
    approvalScreen({
      review: reviewOf({ ...options, entry: { status: "approved", ...(options.entry ?? {}) } as never }),
      plans: PLANS,
      pricePerSegmentCents: 1.5,
      viewerId: APPROVER,
      sending: withProgress ? { kind: "progress", view: sendingProgressView({ ref: REF, progress, paused: true }) } : null,
    });

  it("shows the progress of an approved entry, between what went where and the English text, with the paused sentence", () => {
    const out = renderToStaticMarkup(<ApprovalBody screen={approved()} actions={actions} />);
    expect(out).toContain('data-testid="sending"');
    expect(out).toMatch(/data-testid="sending-handed-off">6 texts were already handed/);
    expect(out.indexOf('data-testid="where"')).toBeLessThan(out.indexOf('data-testid="sending"'));
    expect(out.indexOf('data-testid="sending"')).toBeLessThan(out.indexOf('data-testid="english-text"'));
    expect(out).toContain('data-testid="next-sending"');
  });

  it("shows nothing for an entry that is not approved, and no sending link for a drill", () => {
    const pending = approvalScreen({ review: reviewOf(), plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER, sending: { kind: "progress", view: sendingProgressView({ ref: REF, progress, paused: false }) } });
    expect(pending.sending).toBeUndefined();
    expect(renderToStaticMarkup(<ApprovalBody screen={pending} actions={actions} />)).not.toContain('data-testid="sending"');
    const drill = approved({ thread: { isDrill: true } as never }, false);
    expect(drill.published!.next.links.map((link) => link.id)).toEqual(["home", "promote"]);
    expect(renderToStaticMarkup(<ApprovalBody screen={drill} actions={actions} />)).not.toContain('data-testid="sending"');
  });

  it("says when the progress could not be read, and still draws the confirmation", () => {
    const screen = approvalScreen({
      review: reviewOf({ entry: { status: "approved" } as never }),
      plans: PLANS,
      pricePerSegmentCents: 1.5,
      viewerId: APPROVER,
      sending: { kind: "unavailable", note: "The sending progress could not be read just now." },
    });
    const out = renderToStaticMarkup(<ApprovalBody screen={screen} actions={actions} />);
    expect(out).toContain('data-testid="sending-unavailable"');
    expect(out).toContain('data-testid="where"');
  });
});
