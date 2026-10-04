// What follows a commit that changed what residents read on the web without an approval (S08.03, AD-17): an ambassador's D-1 post that went live at its submit, and
// the discard of such a post, which a system withdrawal replaced. Every transaction that changes web-visible state raised `feed_version` itself; the feed's cache tag
// is expired here, after the commit, so `/api/feed` is read again at once and not after its 15 seconds (`expire: 0`, as the approval does,
// src/app/staff/alerts/approval/afterApproval.ts). It can never turn a change that is done into a failure: whatever it throws is logged and the change stays.
import { revalidateTag } from "next/cache";
import { FEED_TAG } from "@/contracts/feed";

export interface AfterWebChangeDeps {
  /** Next's `revalidateTag`: `{ expire: 0 }` expires the cached feed at once, so the next request reads it again. */
  revalidate: (tag: string, options: { expire: number }) => void;
  /** Where a failure is written (structured, no personal data). */
  log: (line: string) => void;
}

const defaults: AfterWebChangeDeps = {
  revalidate: (tag, options) => revalidateTag(tag, options),
  log: (line) => console.error(line),
};

/** Expires the feed's cache tag after a commit that changed what the web shows. */
export function expireFeed(deps: AfterWebChangeDeps = defaults): void {
  try {
    deps.revalidate(FEED_TAG, { expire: 0 });
  } catch (error) {
    deps.log(JSON.stringify({ evt: "web_change.after_commit_failed", module: "alerting", step: "revalidate_feed", error: error instanceof Error ? error.name : "unknown" }));
  }
}

/** After a submit: the feed is expired when the submit put the entry on the web (a D-1 post). Any other outcome changes nothing residents read. */
export function afterSubmit(report: { state: string; webPublished?: boolean }, deps?: AfterWebChangeDeps): void {
  if (report.state === "committed" && report.webPublished === true) expireFeed(deps);
}
