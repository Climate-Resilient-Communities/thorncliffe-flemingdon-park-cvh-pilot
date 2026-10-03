// A thread that closed on R-07 (S05.03): it shows how it closed in words and an icon of its own for each reason (resolved, expired, withdrawn), the final message as what stands, every
// earlier entry below it, and no valid-until or "reached its end time" note beside the one that says how it ended. The same page, the same words, in every language.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FeedThread } from "@/contracts/feed";
import type { LaunchCode } from "@/i18n/languages";
import { AlertDetail } from "./alert-detail";
import { alertView } from "./alert-view";
import { ID, SERVER_NOW, englishEntry, thread, translatorFor } from "./alert-test-helpers";

const T = (iso: string) => `2026-10-01T${iso}:00.000Z`;
const body = (text: string) => ({ text: { lang: "en" as const, body: text, machine: false, model: null, status: "source" as const, source_hash: "a".repeat(64) }, original: { lang: "en" as const, body: text } });

const FIRST = "Power is out on floors 1 to 6.";
const FINAL = "Power is back on all floors. If your power is still out, call Toronto Hydro.";
const REASON = "This alert had wrong information. It has been withdrawn.";

const ack = englishEntry({ n: 1, kind: "ack", published_at: T("14:00"), ...body(FIRST) });
const update = englishEntry({ n: 2, kind: "update", phase: "in_progress", published_at: T("14:20"), ...body("Work is under way.") });
const final = englishEntry({ n: 3, kind: "final", published_at: T("14:45"), ...body(FINAL) });
const withdrawal = (() => {
  const notice = englishEntry({ n: 4, kind: "withdrawal", supersedes_id: ID(1), published_at: T("14:30"), ...body(REASON) });
  delete notice.phase;
  return notice;
})();

const closed = (reason: string | undefined, entries: FeedThread["entries"]): FeedThread => thread({ state: "closed", ...(reason ? { close_reason: reason } : {}), entries });
const view = (t: FeedThread, lang: "en" | "ur" | "fr" = "en") => alertView(t, { lang: lang as LaunchCode, serverNow: SERVER_NOW, t: translatorFor(lang) });
const detail = (t: FeedThread, lang: "en" | "ur" | "fr" = "en") => {
  const translate = translatorFor(lang);
  return renderToStaticMarkup(<AlertDetail view={alertView(t, { lang: lang as LaunchCode, serverNow: SERVER_NOW, t: translate })} lang={lang as LaunchCode} t={translate} />);
};

describe("a resolved thread", () => {
  const t = closed("resolved", [ack, update, final]);

  it("says it was resolved, when (the final's time), with the check icon, and shows the final message as what stands, the final update first in the thread", () => {
    const v = view(t);
    expect(v.closed).toEqual({ reason: "resolved", icon: "check", title: "Resolved 15 minutes ago", line: "This alert has ended. It was resolved 15 minutes ago." });
    expect(v.current.id).toBe(ID(3));
    expect(v.current.text.body).toBe(FINAL);
    expect(v.current.kindLabel).toBe("Final update");
    expect(v.entries.map((entry) => entry.kind)).toEqual(["final", "update", "ack"]);
  });

  it("has no valid-until and no 'reached its end time' note: it is over, and says how", () => {
    const v = view(closed("resolved", [ack, final]));
    expect(v.valid).toBeNull();
    expect(v.ended).toBeNull();
  });

  it("is drawn with the note, its icon, the final message and every earlier entry, and the time the thread was posted", () => {
    const html = detail(t);
    expect(html).toContain('data-testid="alert-closed" data-reason="resolved"');
    expect(html).toContain('<span class="alert-ico alert-ico--check" aria-hidden="true"></span>');
    expect(html).toContain('data-testid="alert-closed-title">Resolved 15 minutes ago</p>');
    expect(html).toContain("This alert has ended. It was resolved 15 minutes ago.");
    expect(html).toContain(FINAL);
    expect(html).toContain(`data-testid="alert-entry-text-${ID(1)}">${FIRST}</p>`);
    expect(html).not.toContain('data-testid="alert-valid"');
    expect(html).not.toContain('data-testid="alert-ended"');
    // The note comes first, above the alert's words.
    expect(html.indexOf('data-testid="alert-closed"')).toBeLessThan(html.indexOf('data-testid="alert-text"'));
  });
});

describe("an expired thread", () => {
  const t = closed("expired", [ack, update]);

  it("says it expired and when, with the clock icon, and says it had no final update", () => {
    const v = view(t);
    expect(v.closed).toEqual({ reason: "expired", icon: "clock", title: "Expired 40 minutes ago", line: "This alert has ended. It expired 40 minutes ago without a final update." });
    expect(detail(t)).toContain('<span class="alert-ico alert-ico--clock" aria-hidden="true"></span>');
  });
});

describe("a withdrawn thread", () => {
  const t = closed("withdrawn", [ack, withdrawal]);

  it("says it was withdrawn with the withdrawal's own reason, with the information icon, and shows the entry as withdrawn", () => {
    const v = view(t);
    expect(v.closed).toEqual({ reason: "withdrawn", icon: "info", title: "Withdrawn", line: `The Hub withdrew this alert. ${REASON}` });
    expect(v.entries.map((entry) => [entry.id, entry.mark?.kind ?? null])).toEqual([[ID(1), "withdrawn"]]);
    // What stands is the reason, never the wording that was withdrawn, on the page and in the share preview.
    expect(v.current.text.body).toBe(REASON);
    expect(v.current.mark?.kind).toBe("withdrawn");
    expect(v.preview.description).toBe(REASON);
    expect(detail(t)).not.toContain(`>${FIRST}<`);
    expect(detail(t)).toContain('<span class="alert-ico alert-ico--info" aria-hidden="true"></span>');
  });
});

describe("each way a thread closes", () => {
  it("has wording and an icon of its own, so none is read as another", () => {
    const views = (["resolved", "expired", "withdrawn"] as const).map((reason) => view(closed(reason, [ack, update, final, withdrawal])).closed!);
    expect(new Set(views.map((v) => v.icon)).size).toBe(3);
    expect(new Set(views.map((v) => v.title.replace(/ \d+ minutes? ago$/, ""))).size).toBe(3);
    expect(new Set(views.map((v) => v.line)).size).toBe(3);
  });

  it("is said in the resident's language, with the words of the catalog (a machine-translated catalog falls back to English behind its marker)", () => {
    const ur = view(closed("resolved", [ack, final]), "ur").closed!;
    expect(ur.reason).toBe("resolved");
    expect(ur.title.length).toBeGreaterThan(0);
  });

  it("is not said for an open thread, or for a closed one whose reason is not one of the three", () => {
    expect(view(thread({ entries: [ack] })).closed).toBeNull();
    expect(view(closed("archived", [ack, final])).closed).toBeNull();
    expect(view(closed(undefined, [ack, final])).closed).toBeNull();
    expect(detail(thread({ entries: [ack] }))).not.toContain('data-testid="alert-closed"');
  });
});
