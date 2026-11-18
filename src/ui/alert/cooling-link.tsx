"use client";

import Link from "next/link";
import { readFilters, saveFilters, tabStorage } from "../directory/filter-store";
import { setFilter } from "../directory/filters";
import { COOLING_SPACES } from "../directory/quick-cooling";
import { ResidentText } from "../text/resident-text";

/**
 * From a heat alert to the public cooling spaces on the map (resident testing, session 2, #17: alert, then when to call 911, then the guide
 * and the places that can help). The Cooling Spaces filter is set in the tab's own storage (filter-store.ts), never in the address, then the
 * map opens with it on.
 */
export function CoolingLink({ lang, label }: { lang: string; label: string }) {
  const href = `/${lang}/map`;
  return (
    <Link
      className="alert-dest tap"
      href={href}
      prefetch={false}
      data-testid="alert-cooling"
      onClick={() => {
        // Saved before the link navigates, so the map opens with it on.
        const storage = tabStorage();
        saveFilters(storage, setFilter(readFilters(storage), { kind: "subcategory", id: COOLING_SPACES }, true));
      }}
    >
      <span className="alert-cooling__ico" aria-hidden="true" />
      <span className="alert-dest__label">
        <ResidentText>{label}</ResidentText>
      </span>
      <span className="shell-ico shell-ico--chevron shell-ico--mirror" aria-hidden="true" />
    </Link>
  );
}
