// What a resident reads on the archive (R-08, S05.07), worked out from the archive's threads as a pure function: each closed thread is drawn as it is when live (the same
// `alertView`: its types, its words, who sent it and whether the Hub checked it), with how it ended and when. Every "ago" is measured against the answer's own `server_now`,
// never this phone's clock. Nothing here is drawn, so it is unit-tested (archive-view.test.ts).
import type { ArchiveThread } from "@/contracts/feed";
import type { LaunchCode } from "@/i18n/languages";
import { alertView, type AlertView, type Translate } from "../alert/alert-view";
import { agoText } from "../home/feed-poll";

export interface ArchiveCard {
  slug: string;
  /** The thread as the live alert is read: its types, current words and origin. */
  view: AlertView;
  reason: ArchiveThread["close_reason"];
  /** The alert-icons.css mark beside the end line: a check for resolved, a clock for expired, an information mark for withdrawn. */
  icon: "check" | "clock" | "info";
  /** "Resolved 3 days ago", "Expired 2 hours ago", "Withdrawn 5 minutes ago". */
  endLine: string;
  /** "Posted 4 days ago": when the thread's first entry was published. */
  posted: string;
}

const ICONS = { resolved: "check", expired: "clock", withdrawn: "info" } as const;

export function archiveCards(threads: readonly ArchiveThread[], input: { lang: LaunchCode; serverNow: Date; t: Translate }): ArchiveCard[] {
  const { lang, serverNow, t } = input;
  const timeT: Translate = (key, values) => t(`time.${key}`, values);
  const ago = (iso: string) => agoText(serverNow.getTime() - new Date(iso).getTime(), timeT);
  return threads.map((thread) => {
    const view = alertView(thread, { lang, serverNow, t });
    // `entries` is newest first: the last one is the thread's first, when it was posted.
    const first = view.entries.at(-1);
    return {
      slug: thread.slug,
      view,
      reason: thread.close_reason,
      icon: ICONS[thread.close_reason],
      endLine: t(`R08.${thread.close_reason}`, { t: ago(thread.closed_at) }),
      posted: t("R08.endedOn", { posted: first?.time ?? ago(thread.closed_at) }),
    };
  });
}

/** The pages already read, joined in order with a thread that appears twice kept once (a thread that closed between two page reads moves every later one down a place). */
export function joinPages<T extends { slug: string }>(pages: readonly (readonly T[])[]): T[] {
  const seen = new Set<string>();
  return pages.flat().filter((item) => (seen.has(item.slug) ? false : (seen.add(item.slug), true)));
}
