// What the moderation pages read (PRD §6.3; O-08, O-09): the directory module's suggestions on the app's database, with the places module's
// addresses for the buildings a suggestion names (directory may not import places, so the app joins the two). Server only.
import "server-only";
import { listSubmissionQueue, readSubmission } from "@/modules/directory";
import { addressesOfBuildings } from "@/modules/places";
import { directoryDb } from "../directory";
import { queueScreen, reviewScreen, type QueueScreen, type ReviewScreen } from "./view";

/** O-08, or null when the queue could not be read (the page says so). */
export async function loadQueue(now: Date = new Date()): Promise<QueueScreen | null> {
  try {
    return queueScreen(await listSubmissionQueue(directoryDb(), { now: () => now }), now);
  } catch (error) {
    console.error(`moderation.queue_unreadable error=${error instanceof Error ? error.constructor.name : "unknown"}`);
    return null;
  }
}

/** O-09 for one suggestion, or null when there is none with that id. */
export async function loadReview(id: string | undefined, now: Date = new Date()): Promise<ReviewScreen | null> {
  if (!id) return null;
  const db = directoryDb();
  const found = await readSubmission(db, id);
  if (!found) return null;
  const where = found.submission.location;
  const buildings = where?.kind === "building" ? await addressesOfBuildings(db, [where.rsn]) : new Map<string, string>();
  return reviewScreen(found, buildings, now);
}
