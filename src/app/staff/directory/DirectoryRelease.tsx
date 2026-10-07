import Link from "next/link";
import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";
import { PublishDirectory, type PublishDirectoryLabels } from "./PublishDirectory";
import { StaleList } from "./StaleList";

/** What the Directory release screen shows, already in words (see view.ts). */
export interface DirectoryReleaseView {
  /** The current release and its counts, or null before the first publish. */
  current: { headline: string; counts: string; machine: string | null } | null;
  none: string;
  publishedNow: string;
  /** The translations the current release withheld because the English changed, every one. */
  stale: { heading: string; items: string[] } | null;
  /** A release is being built: a run is working on it (in progress) or stopped before the end (stalled). */
  building: { text: string; stalled: boolean } | null;
  /** The last publish failed and no newer release is current. */
  lastFailed: string | null;
  labels: PublishDirectoryLabels;
}

/** The body of the Directory release screen (S02.05): the current release, what it held back, the last failure, and the button. */
export function DirectoryRelease({ view }: { view: DirectoryReleaseView }) {
  return (
    <>
      <Stack gap="related">
        {view.current === null ? (
          <p data-testid="release-none">{view.none}</p>
        ) : (
          <>
            <p data-testid="release-current">{view.current.headline}</p>
            <p data-testid="release-counts">{view.current.counts}</p>
            {view.current.machine && <p data-testid="release-machine">{view.current.machine}</p>}
          </>
        )}
        <p data-testid="release-published-now">{view.publishedNow}</p>
        {view.stale ? <StaleList heading={view.stale.heading} items={view.stale.items} testId="release-stale" /> : null}
        {view.building ? (
          <p role="status" data-testid="release-building" data-state={view.building.stalled ? "stalled" : "in-progress"}>
            {view.building.text}
          </p>
        ) : null}
        {view.lastFailed ? (
          <p role="alert" className="hub-error" data-testid="release-last-failed">
            {view.lastFailed}
          </p>
        ) : null}
      </Stack>
      <PublishDirectory labels={view.labels} />
      <nav aria-label={englishText("staff.journey.directoryLinks")}>
        <Stack gap="related">
          <Link className="hub-link tap" href="/staff/providers">{englishText("staff.journey.providers")}</Link>
          <Link className="hub-link tap" href="/en/directory">{englishText("staff.journey.residentDirectory")}</Link>
        </Stack>
      </nav>
    </>
  );
}
