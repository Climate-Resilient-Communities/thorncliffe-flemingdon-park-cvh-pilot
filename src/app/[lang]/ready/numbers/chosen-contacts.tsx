"use client";

import Link from "next/link";
import { ResidentText } from "@/ui";
import { useChoices } from "@/ui/choices";
import type { BuildingContactCard } from "../view";

// The contacts of the buildings a resident chose (S02.10, S02.08). The choices live only on the phone (AD-3,
// `cvh.choices`), so the server sends every pilot building's contact and the phone picks its own: the server never
// learns which buildings were chosen, and this page is the same for everyone (cacheable).

export type ChosenContactsProps = {
  /** "Your building" */
  title: string;
  /** "Choose your building and we will show its contact here when we have one. Until then, the Hub can help." */
  noneChosen: string;
  /** "Choose your building" */
  chooseLabel: string;
  chooseHref: string;
  /** "We don't have a contact for your building yet. Your floor ambassador can help." */
  noContact: string;
  /** "Call" */
  call: string;
  /** True when `call` is English standing in for a missing translation: the button then reads as English, left to right. */
  callIsEnglish: boolean;
  /** Every pilot building, by address; the phone picks its own. */
  buildings: readonly BuildingContactCard[];
};

function Card({ card, props }: { card: BuildingContactCard; props: ChosenContactsProps }) {
  return (
    <li className="num" data-testid="building-contact-card" data-rsn={card.rsn}>
      {card.role !== null && card.tel !== null && card.phone !== null ? (
        <>
          <ResidentText as="p" className="num__purpose" testId="building-contact-role">
            {card.role}
          </ResidentText>
          <p className="ready-caption" data-testid="building-contact-address">
            {/* A street address is written in English and read left to right, whatever the page's language. */}
            <bdi lang="en" dir="ltr">
              {card.address}
            </bdi>
          </p>
          <div className="num__row">
            <bdi dir="ltr" lang="en" className="num__digits" data-testid="building-contact-phone">
              {card.phone}
            </bdi>
            <a
              className="ready-btn ready-btn--secondary tap"
              href={card.tel}
              aria-label={card.callAria ?? undefined}
              data-testid="building-contact-call"
              {...(props.callIsEnglish ? { dir: "ltr", lang: "en" } : {})}
            >
              <span className="shell-ico shell-ico--phone shell-ico--sm" aria-hidden="true" />
              <ResidentText>{props.call}</ResidentText>
            </a>
          </div>
          <ResidentText as="p" className="ready-caption" testId="building-contact-provided">
            {card.provided ?? ""}
          </ResidentText>
        </>
      ) : (
        <>
          <p className="num__purpose" data-testid="building-contact-address">
            <bdi lang="en" dir="ltr">
              {card.address}
            </bdi>
          </p>
          <ResidentText as="p" testId="building-contact-none">
            {props.noContact}
          </ResidentText>
        </>
      )}
    </li>
  );
}

/**
 * "Your building" on the essential-numbers page: one card for each building the resident chose, with the Hub's contact
 * for it or, when the Hub has none, a plain line saying so. With no building chosen, an invitation to choose. Until the
 * phone has been read nothing is drawn (the server cannot know), so the page never shows a wrong building for a moment.
 */
export function ChosenContacts(props: ChosenContactsProps) {
  const choices = useChoices();
  if (choices === undefined) return null;
  const chosen = [...new Set(choices?.buildings ?? [])];
  const byRsn = new Map(props.buildings.map((card) => [card.rsn, card]));
  // A building the list no longer has (removed since it was chosen) is skipped.
  const cards = chosen.flatMap((rsn) => byRsn.get(rsn) ?? []);

  return (
    <section data-testid="numbers-buildings" className="ready-section">
      <ResidentText as="h2">{props.title}</ResidentText>
      {cards.length > 0 ? (
        <ul className="numlist">
          {cards.map((card) => (
            <Card key={card.rsn} card={card} props={props} />
          ))}
        </ul>
      ) : (
        <div className="num" data-testid="numbers-no-building">
          <ResidentText as="p">{props.noneChosen}</ResidentText>
          <Link href={props.chooseHref} prefetch={false} className="ready-link tap" data-testid="numbers-choose">
            <ResidentText>{props.chooseLabel}</ResidentText>
            <span className="shell-ico shell-ico--chevron shell-ico--mirror shell-ico--sm" aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  );
}
