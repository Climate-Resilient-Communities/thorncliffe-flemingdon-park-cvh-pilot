import { englishText } from "@/i18n/text";
import type { ReleaseSummary } from "@/modules/directory";
import type { DirectoryReleaseView } from "./DirectoryRelease";
import { failureReason, staleLines } from "./words";

export interface ProviderTotals {
  published: number;
  total: number;
}

/**
 * The words of the Directory release screen for the current release, the newest release of any status (a failed one
 * shows only while no newer release is current) and the providers now in the catalogue. `day` writes a time as the Hub's
 * calendar day (Toronto); `now` tells a publish in progress (its run holds a live lease) from one that stalled.
 */
export function directoryReleaseView(
  current: ReleaseSummary | null,
  latest: ReleaseSummary | null,
  providers: ProviderTotals,
  day: (date: Date) => string,
  now: Date,
): DirectoryReleaseView {
  // A build the next press closed as too old ("abandoned") is not a failure the Admin needs to see.
  const failed = latest !== null && latest.status === "failed" && latest.failure !== "abandoned" && (current === null || latest.number > current.number) ? latest : null;
  const stale = current === null ? [] : staleLines(current.report);
  // A release still being built is the newest one: a run holds its lease (in progress), or the run stopped (stalled).
  const stalled = latest !== null && latest.status === "building" && (latest.leaseUntil === null || latest.leaseUntil <= now);
  const building =
    latest !== null && latest.status === "building"
      ? { stalled, text: englishText(stalled ? "staff.directory.stalled" : "staff.directory.inProgress", { number: latest.number }) }
      : null;
  return {
    current:
      current === null
        ? null
        : {
            headline: englishText("staff.directory.current", { number: current.number, date: current.publishedAt ? day(current.publishedAt) : "" }),
            counts: englishText("staff.directory.currentCounts", {
              providers: current.counts.providers,
              categories: current.counts.categories,
              languages: current.counts.languages,
            }),
            machine: (current.counts.machine ?? 0) > 0 ? englishText("staff.directory.currentMachine", { count: current.counts.machine ?? 0 }) : null,
          },
    none: englishText("staff.directory.none"),
    publishedNow: englishText("staff.directory.publishedNow", { published: providers.published, total: providers.total }),
    stale: stale.length === 0 ? null : { heading: englishText("staff.directory.staleHeading", { count: stale.length }), items: stale },
    building,
    lastFailed: failed
      ? `${englishText("staff.directory.lastFailed", { reason: failureReason(failed.failure ?? "unexpected") })}. ${englishText("staff.directory.previousStays")}`
      : null,
    labels: {
      publish: englishText("staff.directory.publish"),
      publishing: englishText("staff.directory.publishing"),
      publishHint: englishText("staff.directory.publishHint"),
    },
  };
}
