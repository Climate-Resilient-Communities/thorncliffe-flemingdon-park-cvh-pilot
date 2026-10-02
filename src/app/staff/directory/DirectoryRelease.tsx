import { Stack } from "@/ui";
import { PublishDirectory, type PublishDirectoryLabels } from "./PublishDirectory";
import { StaleList } from "./StaleList";

/** What the Directory release screen shows, already in words (see view.ts). */
export interface DirectoryReleaseView {
  /** The current release and its counts, or null before the first publish. */
  current: { headline: string; counts: string } | null;
  none: string;
  publishedNow: string;
  /** The translations the current release withheld because the English changed, every one. */
  stale: { heading: string; items: string[] } | null;
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
          </>
        )}
        <p data-testid="release-published-now">{view.publishedNow}</p>
        {view.stale ? <StaleList heading={view.stale.heading} items={view.stale.items} testId="release-stale" /> : null}
        {view.lastFailed ? (
          <p role="alert" className="hub-error" data-testid="release-last-failed">
            {view.lastFailed}
          </p>
        ) : null}
      </Stack>
      <PublishDirectory labels={view.labels} />
    </>
  );
}
