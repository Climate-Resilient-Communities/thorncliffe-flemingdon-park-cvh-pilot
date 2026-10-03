// What follows an approval that has committed (S04.07, AD-17, AD-8): the resident feed's cache tag is revalidated, so `/api/feed` is read again at once
// and not after its 15 seconds, and the sender is kicked, so the texts the approval queued start going out without waiting for pg_cron's next minute.
// It runs only after the approval's transaction committed, only for an approval (a refusal or a rollback changes nothing, so nothing follows), and can
// never turn an approval that is done into a failure: whatever it throws is logged and the approval stays approved.
//
// A drill changes nothing the web shows (the approval raised no feed_version for it), so it revalidates nothing; it still kicks the sender, for the
// drill roster's texts.
//
// The kick is S06.02's `kickDispatcher()` (src/app/dispatch.ts), called here once, with no argument. It schedules the sender's run with `after()`, so it
// never waits and never throws; its run (KICK_RUN_LIMIT_MS, 20 seconds) lives inside the function of the request that approved, after the response,
// and shares that function's time, which is why the page that hosts the approval's actions exports `maxDuration = 60` as a literal
// (src/app/staff/alerts/approve/page.tsx, read statically by approvalKick.test.ts): a function stopped mid-run could leave a text handed off with no
// provider call, and that text becomes `unknown` after 5 minutes and is never sent again.
import { revalidateTag } from "next/cache";
import { FEED_TAG } from "@/contracts/feed";
import type { ApprovalOutcome } from "@/modules/alerting";

export interface AfterApprovalDeps {
  /** Next's `revalidateTag`: `{ expire: 0 }` expires the cached feed at once, so the next request reads it again. */
  revalidate: (tag: string, options: { expire: number }) => void;
  /** S06.02's `kickDispatcher()`: starts the sender after the response, never throws, never waits for the run. */
  kickDispatcher: () => void | Promise<void>;
  /** Where a failure of either is written (structured, no personal data). */
  log: (line: string) => void;
}

const defaults: AfterApprovalDeps = {
  revalidate: (tag, options) => revalidateTag(tag, options),
  // Imported when it is needed, as the pause page does (src/app/staff/messagingPause.ts#startSending): the sender's composition (Twilio, the job
  // secret) is not part of every module that imports the approval's actions.
  kickDispatcher: async () => {
    const { kickDispatcher } = await import("@/app/dispatch");
    kickDispatcher();
  },
  log: (line) => console.error(line),
};

/** Revalidates the feed after an approval that changed what the web shows, and kicks the dispatcher (S06.02). */
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
    await deps.kickDispatcher();
  } catch (error) {
    failed("kick_dispatcher", error);
  }
}
