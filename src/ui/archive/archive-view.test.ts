import { describe, expect, it } from "vitest";
import type { ArchiveThread } from "@/contracts/feed";
import { ENGLISH, ID, SERVER_NOW, englishEntry, thread, translatorFor } from "../alert/alert-test-helpers";
import { archiveCards, joinPages } from "./archive-view";

const t = translatorFor("en");
const ago = (minutes: number) => new Date(SERVER_NOW.getTime() - minutes * 60_000).toISOString();

function closed(over: Partial<ArchiveThread> & { reason?: ArchiveThread["close_reason"]; endedMinutesAgo?: number } = {}): ArchiveThread {
  const { reason = "resolved", endedMinutesAgo = 90, ...rest } = over;
  return {
    ...thread({ entries: [englishEntry({ n: 1, published_at: ago(300) }), englishEntry({ n: 2, kind: "final", published_at: ago(endedMinutesAgo) })] }),
    state: "closed",
    close_reason: reason,
    closed_at: ago(endedMinutesAgo),
    ...rest,
  };
}

const cards = (threads: ArchiveThread[]) => archiveCards(threads, { lang: "en", serverNow: SERVER_NOW, t });

describe("archiveCards (R-08)", () => {
  it("says how each thread ended and when, by the server's clock and the closing time, with the prototype's words", () => {
    const [resolved, expired, withdrawn] = cards([closed({ reason: "resolved", endedMinutesAgo: 90 }), closed({ reason: "expired", endedMinutesAgo: 60 * 5 }), closed({ reason: "withdrawn", endedMinutesAgo: 3 })]);

    expect(resolved).toMatchObject({ reason: "resolved", icon: "check", endLine: "Resolved 1 hour ago" });
    expect(expired).toMatchObject({ reason: "expired", icon: "clock", endLine: "Expired 5 hours ago" });
    expect(withdrawn).toMatchObject({ reason: "withdrawn", icon: "info", endLine: "Withdrawn 3 minutes ago" });
  });

  it("says when the alert was posted: the time of its first entry", () => {
    const [card] = cards([closed({ endedMinutesAgo: 90 })]);

    expect(card.posted).toBe("Posted 5 hours ago");
  });

  it("draws the thread as the live alert is drawn: its types, its words, who sent it and whether it was checked", () => {
    const [card] = cards([closed()]);

    expect(card.slug).toBe("kbcdfghj");
    expect(card.view.types.map((type) => type.id)).toEqual(["elevator"]);
    expect(card.view.current.text.body).toBe(ENGLISH);
    expect(card.view.origin).toMatchObject({ verified: true, verification: "Verified by the Hub" });
  });

  it("keeps the order it is given (the server's: newest closed first)", () => {
    const list = cards([closed({ slug: "second0", endedMinutesAgo: 10 }), closed({ slug: "first00", endedMinutesAgo: 30 })]);

    expect(list.map((card) => card.slug)).toEqual(["second0", "first00"]);
  });

  it("shows a thread closed withdrawn by the reason that stands in the place of what was withdrawn, never the withdrawn wording", () => {
    const original = englishEntry({ n: 1, published_at: ago(300) });
    const notice = englishEntry({ n: 2, kind: "withdrawal", supersedes_id: ID(1), published_at: ago(10), text: { lang: "en", body: "Sent for the wrong building.", machine: false, model: null, status: "source", source_hash: "h" } });

    const [card] = cards([closed({ reason: "withdrawn", endedMinutesAgo: 10, entries: [original, notice] })]);

    expect(card.view.current.text.body).toBe("Sent for the wrong building.");
    expect(card.view.current.mark?.kind).toBe("withdrawn");
  });
});

describe("joinPages", () => {
  it("joins pages in order and keeps a thread that moved down a page once", () => {
    const joined = joinPages([[{ slug: "a" }, { slug: "b" }], [{ slug: "b" }, { slug: "c" }], [{ slug: "d" }]]);

    expect(joined.map((item) => item.slug)).toEqual(["a", "b", "c", "d"]);
  });

  it("is empty for no pages", () => {
    expect(joinPages([])).toEqual([]);
  });
});
