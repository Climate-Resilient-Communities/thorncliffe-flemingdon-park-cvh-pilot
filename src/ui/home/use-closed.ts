"use client";

import { useEffect, useRef, useState } from "react";
import { ARCHIVE_EDGE_MAX_AGE_SECONDS, RESOLVED_WINDOW_MS, type ArchiveV1, type FeedV1 } from "@/contracts/feed";
import { fetchArchivePage } from "../archive/fetch-archive";
import type { ClosedThreads } from "./home-view";

/** Whether any place the feed lists is `resolved`: the same for every phone, so asking for the archive because of it says nothing about this phone's choices (AD-3). */
export const anyResolved = (feed: FeedV1 | null): boolean => feed !== null && [...feed.places.buildings, ...feed.places.neighbourhoods].some((place) => place.status === "resolved");

/** How many more times the archive is asked, ARCHIVE_EDGE_MAX_AGE_SECONDS apart, while it lacks the thread behind a resolved status (an edge copy from before the close). */
export const ARCHIVE_RETRIES = 3;

/** Whether an archive page cannot be the answer to a feed that lists a `resolved` place: it holds no thread closed `resolved` within the window, so it is older than the close. Pure (unit-tested). */
export const archiveLacksResolved = (feed: FeedV1 | null, page: ArchiveV1): boolean =>
  anyResolved(feed) && !page.threads.some((thread) => thread.close_reason === "resolved" && Date.parse(page.server_now) - Date.parse(thread.closed_at) < RESOLVED_WINDOW_MS);

/**
 * The threads that closed, when the feed has a `resolved` place (S05.07): the feed does not name the thread behind that status (its list is the open threads, and FeedV1
 * cannot grow a field the phones in the field refuse), so the archive's newest page is asked for, and home links the status to the closed thread (R-07). Asked again when the
 * feed's version changes (a thread closed since), never otherwise, and not at all when nothing is resolved. A failure leaves the status without its link, never without
 * its words. The archive's edge copy may be up to 60 seconds old, older than the close the feed already shows, so while the page holds no thread behind the
 * resolved status it is asked again after ARCHIVE_EDGE_MAX_AGE_SECONDS, up to ARCHIVE_RETRIES times. The phone's choices are not sent: the request is the same for everyone.
 */
export function useClosedThreads(lang: string, feed: FeedV1 | null): ClosedThreads | null {
  const wanted = anyResolved(feed);
  const version = feed?.feed_version ?? -1;
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  }, [feed]);
  const [found, setFound] = useState<{ lang: string; closed: ClosedThreads } | null>(null);

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (retriesLeft: number) => {
      void fetchArchivePage(lang, 1).then((page) => {
        if (!live) return;
        if (page) setFound({ lang, closed: { threads: page.threads, serverNow: new Date(page.server_now) } });
        if ((!page || archiveLacksResolved(feedRef.current, page)) && retriesLeft > 0) timer = setTimeout(() => ask(retriesLeft - 1), ARCHIVE_EDGE_MAX_AGE_SECONDS * 1000);
      });
    };
    ask(ARCHIVE_RETRIES);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [lang, wanted, version]);

  return wanted && found?.lang === lang ? found.closed : null;
}
