// Composition root of the sending progress for the staff surface (S06.09, AD-2): messaging's counts of what became of an entry's texts on the app's
// database connection, and whether texts are paused (S06.06) for the line the progress view adds while they are. Server only. A seam of its own, like
// ./messagingPause.ts and ../drills.ts, so the tests that call the staff pages directly can hand them a database.
import "server-only";
import { MessagingControlMissing, sendingProgress, type EntryProgress, type ProblemState, type ProblemText } from "@/modules/messaging";
import { getDb } from "@/platform/db";
import { logPauseError, messagingPause } from "./messagingPause";

export interface ProgressReader {
  /** What became of an entry's texts: counts per language. */
  forEntry: (entryId: string) => Promise<EntryProgress>;
  /** The entry's texts that failed, were undelivered or have an unknown outcome (or one of the three), each with what it means. */
  problemTexts: (entryId: string, state?: ProblemState) => Promise<{ texts: ProblemText[]; more: boolean }>;
}

export function progressReader(): ProgressReader {
  return {
    forEntry: (entryId) => sendingProgress.forEntry(getDb(), entryId),
    problemTexts: (entryId, state) => sendingProgress.problemTexts(getDb(), entryId, state),
  };
}

/**
 * Whether texts are paused now, for the progress view. A switch with no row counts as paused (the sender holds every text then); a switch that cannot be
 * read is logged by the error's name and counts as not paused: the line it adds only informs, and never keeps the progress from being shown.
 */
export async function textsArePaused(): Promise<boolean> {
  try {
    return (await messagingPause().status()).paused;
  } catch (error) {
    logPauseError("messaging.pause_status_failed", { error: error instanceof Error ? error.name : "NonError" });
    return error instanceof MessagingControlMissing;
  }
}
