// What follows an approval that has committed (S04.07, AD-17): the resident feed's cache tag is revalidated, so `/api/feed` is read again at once
// and not after its 15 seconds. It runs only after the approval's transaction committed, only for an approval (a refusal changes nothing, so
// nothing follows), and can never turn an approval that is done into a failure: whatever it throws is logged and the approval stays approved.
//
// A drill changes nothing the web shows (the approval raised no feed_version for it), so it revalidates nothing.
//
// E06's HOOK (S06.02): the dispatcher is kicked here, once, after the commit and never when the approval was refused:
//   import { kickDispatcher } from "@/app/dispatch";  ...  kickDispatcher: () => kickDispatcher()   (it schedules a run with `after()`, never throws, never waits)
// `kickDispatcher` below is that seam, a no-op until E06 is merged, and the page that hosts the approval's actions exports `maxDuration = 60`
// (src/app/staff/alerts/approve/page.tsx), because the dispatcher's run lives in that function after the response and shares its time.
import { revalidateTag } from "next/cache";
import { FEED_TAG } from "@/contracts/feed";
import type { ApprovalOutcome } from "@/modules/alerting";

export interface AfterApprovalDeps {
  /** Next's `revalidateTag`: `{ expire: 0 }` expires the cached feed at once, so the next request reads it again. */
  revalidate: (tag: string, options: { expire: number }) => void;
  /** E06 (S06.02): `kickDispatcher()`. A no-op until then. */
  kickDispatcher: () => void;
  /** Where a failure of either is written (structured, no personal data). */
  log: (line: string) => void;
}

const defaults: AfterApprovalDeps = {
  revalidate: (tag, options) => revalidateTag(tag, options),
  kickDispatcher: () => undefined,
  log: (line) => console.error(line),
};

/** Revalidates the feed after an approval that changed what the web shows, and kicks the dispatcher (E06). */
export async function afterApproval(outcome: ApprovalOutcome, deps: AfterApprovalDeps = defaults): Promise<void> {
  const failed = (step: string, error: unknown) => deps.log(JSON.stringify({ evt: "approval.after_commit_failed", module: "alerting", step, error: error instanceof Error ? error.name : "unknown" }));
  // A feed version was raised exactly when the web shows something new: the tag is expired at once, not at the end of its 15 seconds.
  if (outcome.feedVersion !== null) {
    try {
      deps.revalidate(FEED_TAG, { expire: 0 });
    } catch (error) {
      failed("revalidate_feed", error);
    }
  }
  try {
    deps.kickDispatcher();
  } catch (error) {
    failed("kick_dispatcher", error);
  }
}
