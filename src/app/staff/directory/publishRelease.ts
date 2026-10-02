import { englishText } from "@/i18n/text";
import { publishDirectory, type PublishDeps, type PublishResult } from "@/modules/directory";
import type { Db } from "@/platform/db";
import type { StaffSession } from "../session";
import { catalogueMismatchText, failureReason } from "./words";

/** What the Publish directory button shows after it was pressed. Every text is already resolved from the catalog. */
export type PublishState =
  | { status: "idle" }
  | { status: "done"; message: string; notes: string[] }
  | { status: "refused"; message: string; problems: string | null };

export interface PublishActionDeps {
  db: () => Db;
  publish: () => PublishDeps;
}

function done(result: Extract<PublishResult, { ok: true }>): PublishState {
  const notes: string[] = [];
  if (result.resumedFiles > 0) notes.push(englishText("staff.directory.resumed", { files: result.resumedFiles }));
  if (result.counts.fallbacks - result.counts.stale > 0) notes.push(englishText("staff.directory.fallbacks", { count: result.counts.fallbacks - result.counts.stale }));
  notes.push(
    result.search === null
      ? englishText("staff.directory.searchNone")
      : englishText("staff.directory.searchData", { vectors: result.search.vectors, reused: result.search.reused, embedded: result.search.embedded }),
  );
  return {
    status: "done",
    message: englishText("staff.directory.done", { number: result.release, providers: result.counts.providers, languages: result.counts.languages }),
    notes,
  };
}

function refused(result: Extract<PublishResult, { ok: false }>): PublishState {
  if (result.reason === "publish_running") return { status: "refused", message: englishText("staff.directory.running"), problems: null };
  return {
    status: "refused",
    message: `${englishText("staff.directory.failed", { reason: failureReason(result.reason) })}. ${englishText("staff.directory.previousStays")}`,
    problems: result.catalogue
      ? catalogueMismatchText(result.catalogue)
      : result.detail.length === 0
        ? null
        : englishText("staff.directory.problems", { list: result.detail.join("; ") }),
  };
}

/** "Publish directory": runs the job as the signed-in Admin; the job decides, retries, audits and records a failure. */
export async function publishFromForm(deps: PublishActionDeps, session: Pick<StaffSession, "staffId">): Promise<PublishState> {
  let publishDeps: PublishDeps;
  try {
    publishDeps = deps.publish();
  } catch {
    // The store is not configured in this environment: nothing was started, and nothing is claimed.
    return { status: "refused", message: `${englishText("staff.directory.failed", { reason: failureReason("storage_unavailable") })}. ${englishText("staff.directory.previousStays")}`, problems: null };
  }
  const result = await publishDirectory(deps.db(), publishDeps, session.staffId);
  return result.ok ? done(result) : refused(result);
}
