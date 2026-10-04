"use client";

import { useEffect, useState } from "react";
import type { FeedV1 } from "@/contracts/feed";
import { fetchArchivePage } from "../archive/fetch-archive";
import type { ClosedThreads } from "./home-view";

/** Whether any place the feed lists is `resolved`: the same for every phone, so asking for the archive because of it says nothing about this phone's choices (AD-3). */
export const anyResolved = (feed: FeedV1 | null): boolean => feed !== null && [...feed.places.buildings, ...feed.places.neighbourhoods].some((place) => place.status === "resolved");

/**
 * The threads that closed, when the feed has a `resolved` place (S05.07): the feed does not name the thread behind that status (its list is the open threads, and FeedV1
 * cannot grow a field the phones in the field refuse), so the archive's newest page is asked for, and home links the status to the closed thread (R-07). Asked again when the
 * feed's version changes (a thread closed since), never otherwise, and not at all when nothing is resolved. A failure leaves the status without its link, never without
 * its words. The phone's choices are not sent: the request is the same for everyone.
 */
export function useClosedThreads(lang: string, feed: FeedV1 | null): ClosedThreads | null {
  const wanted = anyResolved(feed);
  const version = feed?.feed_version ?? -1;
  const [found, setFound] = useState<{ lang: string; closed: ClosedThreads } | null>(null);

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void fetchArchivePage(lang, 1).then((page) => {
      if (live && page) setFound({ lang, closed: { threads: page.threads, serverNow: new Date(page.server_now) } });
    });
    return () => {
      live = false;
    };
  }, [lang, wanted, version]);

  return wanted && found?.lang === lang ? found.closed : null;
}
