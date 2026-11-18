"use client";

import Link from "next/link";
import { ResidentText } from "@/ui";
import { saveFilters, tabStorage } from "@/ui/directory/filter-store";
import { NO_FILTERS } from "@/ui/directory/filters";
import { GUIDE_SERVICES } from "./resources";

// "Help with this" (resident testing, session 2, #18: the Be ready guides should link to resources; the prototype's R-25): the services that can
// help with this hazard, and for heat, smoke and power outages the places open as a space for it. The services link narrows the directory by the
// hazard's filters, set in the tab's own storage (filter-store.ts) before it opens, never in the address. Chosen by hand per guide, from the
// catalogue's own kinds of place and Find help's topics, so a new provider joins by its kind, not by a list here.

export function GuideHelp({ lang, guide, labels }: { lang: string; guide: string; labels: { title: string; services: string; spaces: string | null } }) {
  const services = GUIDE_SERVICES[guide];
  if (!services) return null;
  return (
    <section className="guide-help" aria-labelledby="guide-help-title" data-testid="guide-help">
      <ResidentText as="h2" testId="guide-help-title">
        {labels.title}
      </ResidentText>
      <Link
        className="ready-link tap"
        href={`/${lang}/directory`}
        prefetch={false}
        data-testid="guide-help-services"
        onClick={() => {
          // The hazard's filters replace the kept ones, so the list is about this guide.
          const storage = tabStorage();
          saveFilters(storage, { ...NO_FILTERS, ...services });
        }}
      >
        <span className="shell-ico shell-ico--search shell-ico--sm" aria-hidden="true" />
        <ResidentText>{labels.services}</ResidentText>
        <span className="shell-ico shell-ico--chevron shell-ico--mirror shell-ico--sm" aria-hidden="true" />
      </Link>
      {labels.spaces && (
        <Link className="ready-link tap" href={`/${lang}/map?spaces=open`} prefetch={false} data-testid="guide-help-spaces">
          <span className="shell-ico shell-ico--map shell-ico--sm" aria-hidden="true" />
          <ResidentText>{labels.spaces}</ResidentText>
          <span className="shell-ico shell-ico--chevron shell-ico--mirror shell-ico--sm" aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}
