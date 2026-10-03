// The notice an approver sees while texts are paused (S06.06, E06 "Pause"): "Texts are paused; this will send when resumed". A text approved
// or created during a pause queues normally (the pause is only read by the sender), so the approval is never refused or changed by it; the
// notice is the one thing the approver is told. S04.07's approval screen and its confirmation call `pauseNoticeForApprover()` and show
// what it answers, when it answers anything. The sentence is the catalog's (`staff.texts.paused.approver`).
import { logPauseError, messagingPause } from "./messagingPause";
import { approverPauseNotice } from "./texts/view";

export interface PauseNoticeDeps {
  /** Whether texts are paused now. */
  paused: () => Promise<boolean>;
  /** Operational error log (structured, no personal data): the error's name only. */
  logError: (event: string, fields: Record<string, string>) => void;
}

const live: PauseNoticeDeps = {
  paused: async () => (await messagingPause().status()).paused,
  logError: logPauseError,
};

/**
 * The approver's notice while texts are paused, or null when they are not. If the switch cannot be read the approver is shown nothing and
 * the failure is logged by the error's name: the notice informs, it neither guards nor blocks the approval (the text queues either way).
 */
export async function pauseNoticeForApprover(deps: PauseNoticeDeps = live): Promise<string | null> {
  try {
    return (await deps.paused()) ? approverPauseNotice() : null;
  } catch (error) {
    deps.logError("messaging.pause_notice_failed", { error: error instanceof Error ? error.name : "NonError" });
    return null;
  }
}
