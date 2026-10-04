"use client";

import { useEffect, useState } from "react";
import { ResidentText } from "../text/resident-text";
import { listKeptPages, type KeptPage } from "./support";

// Its styles (offline.css) come with globals.css (see offline-support.tsx).

/**
 * The offline page's list of the pages of `lang` this phone can read without signal (S02.12), read from the service
 * worker's caches on the phone. Each is a plain link: opening it without signal shows the kept copy. A page is named by
 * its own title as it was kept. `none` is said when nothing but the offline page is kept.
 */
export function KeptPages({ lang, none }: { lang: string; none: string }) {
  const [pages, setPages] = useState<KeptPage[] | null>(null);

  useEffect(() => {
    let live = true;
    void listKeptPages(typeof caches === "undefined" ? undefined : caches, window.location.origin, lang).then((found) => {
      if (live) setPages(found);
    });
    return () => {
      live = false;
    };
  }, [lang]);

  if (pages === null) return null;
  if (pages.length === 0) {
    return (
      <ResidentText as="p" testId="kept-none">
        {none}
      </ResidentText>
    );
  }
  return (
    <ul className="offline-list" data-testid="kept-pages">
      {pages.map((page) => (
        <li key={page.path}>
          {/* A plain link, not Next's: Next would ask the server for the page's data, which fails without signal. */}
          <a className="offline-link tap" href={page.path} data-testid={`kept-${page.path}`}>
            <bdi>{page.title ?? page.path}</bdi>
          </a>
        </li>
      ))}
    </ul>
  );
}
