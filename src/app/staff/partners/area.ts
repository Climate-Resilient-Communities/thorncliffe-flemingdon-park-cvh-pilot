// The Hub and partner space's two areas as the pages link them (the prototype's C_HubSide sections, 2026-11-07): "This disruption" (P-02 and
// what it links to) and "Between disruptions" (P-11 to P-16). One list, so the side navigation (hubShell.ts) and the links on each page name
// the same pages with the same words. Each page is the policy action `space.view`.
import { englishText } from "@/i18n/text";
import { PARTNER_PAGES } from "./view";
import { pw } from "./words";

export interface AreaLink {
  id: string;
  href: string;
  label: string;
}

/** "This disruption", in the prototype's order: the shared space, coverage, our spaces, supplies, decisions, capacity. */
export function disruptionLinks(): AreaLink[] {
  return [
    { id: "space", href: PARTNER_PAGES.space, label: englishText("hub.nav.space") },
    { id: "space-coverage", href: PARTNER_PAGES.coverage, label: englishText("P02.links.coverage") },
    { id: "our-spaces", href: PARTNER_PAGES.ourSpaces, label: englishText("hub.nav.ourSpaces") },
    { id: "supplies", href: PARTNER_PAGES.supplies, label: englishText("hub.nav.supplies") },
    { id: "decisions", href: PARTNER_PAGES.decisions, label: englishText("hub.nav.decisions") },
    { id: "capacity", href: PARTNER_PAGES.capacity, label: englishText("hub.nav.capacity") },
  ];
}

/** The pages P-02 reaches that are not in the navigation: opening a space (P-01) and the handover (P-10). */
export function disruptionActions(): AreaLink[] {
  return [
    { id: "open", href: PARTNER_PAGES.open, label: pw("open.title") },
    { id: "handover", href: PARTNER_PAGES.handover, label: englishText("P02.links.handover") },
  ];
}

/** "Between disruptions", in the prototype's order. */
export function readinessLinks(): AreaLink[] {
  return [
    { id: "commitments", href: PARTNER_PAGES.commitments, label: englishText("hub.nav.commitments") },
    { id: "playbooks", href: PARTNER_PAGES.playbooks, label: englishText("hub.nav.playbooks") },
    { id: "teams", href: PARTNER_PAGES.teams, label: englishText("hub.nav.teams") },
    { id: "exercise", href: PARTNER_PAGES.exercise, label: englishText("hub.nav.exercise") },
    { id: "indicators", href: PARTNER_PAGES.indicators, label: englishText("hub.nav.indicators") },
    { id: "look-back", href: PARTNER_PAGES.lookBack, label: englishText("hub.nav.lookBack") },
  ];
}
