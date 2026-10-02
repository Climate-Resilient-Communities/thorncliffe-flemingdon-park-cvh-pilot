"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ListingProvider, ListingText } from "@/contracts/directory";
import type { LaunchCode } from "@/i18n/languages";
import { languageOf } from "@/i18n/languages";
import { isEnglishFallback, ResidentText } from "../text/resident-text";
import { Isolated } from "../text/isolated";
import { phoneEntries, socialEntries, webEntry } from "./contact";
import { formatDayText } from "./format";
import { HowTheyHelp, ListingBlock, MachineLabel, isMachineText } from "./listing-text";
import { neighbourhoodName } from "./neighbourhood-names";
import "./directory.css";

export type CategoryNames = ReadonlyMap<string, ListingText>;

const NBSP = "\u00a0";

/** A postal code ("M4H 1K2") with a non-breaking space inside, so a line never ends between its two halves. */
export const postalText = (postal: string): string => postal.trim().replace(/\s+/g, NBSP);

/** Each address of a provider on one line, in English and left to right (an address is written the same way in every language). */
export function addressLines(provider: Pick<ListingProvider, "locations">): string[] {
  return provider.locations
    .map(({ street, city, postal }) => [street, city, postal && postalText(postal)].filter((part) => part && part.trim() !== "").join(", "))
    .filter((line) => line !== "");
}

/** Every text on the card that a model translated, for the label. */
function machineTexts(provider: ListingProvider, categories: CategoryNames): ListingText[] {
  const names = provider.category_ids.map((id) => categories.get(id)).filter((text): text is ListingText => text !== undefined);
  return [provider.services, ...(provider.emergency_role ? [provider.emergency_role] : []), ...provider.subcategories, ...names].filter(isMachineText);
}

function Unknown({ children }: { children: string }) {
  return (
    <span className="dir-unknown" data-testid="not-known">
      <span className="dir-unknown__mark" aria-hidden="true" />
      <ResidentText>{children}</ResidentText>
    </span>
  );
}

function Contacts({ provider }: { provider: ListingProvider }) {
  const t = useTranslations();
  const call = t("R12.call");
  const callIsEnglish = isEnglishFallback(call);
  const phones = phoneEntries(provider.contact.phone);
  const emails = provider.contact.email.map((e) => e.trim()).filter((e) => e !== "");
  const webs = provider.contact.web.map(webEntry).filter((w): w is NonNullable<typeof w> => w !== null);
  const social = socialEntries(provider.contact.social);
  if (phones.length + emails.length + webs.length + social.length === 0) return <Unknown>{t("status.unknown")}</Unknown>;

  return (
    <ul className="dir-contacts">
      {phones.map((entry, at) => (
        <li key={`p${at}`}>
          {entry.tel ? (
            // A "Call" that fell back to English makes the whole button English, left to right, so its words and the number read as one line.
            <a className="dir-call tap" href={`tel:${entry.tel}`} data-testid="provider-call" {...(callIsEnglish ? { dir: "ltr", lang: "en" } : {})}>
              <ResidentText>{call}</ResidentText>{" "}
              <bdi dir="ltr" lang="en">
                {entry.text}
              </bdi>
            </a>
          ) : (
            <bdi dir="ltr" lang="en">
              {entry.text}
            </bdi>
          )}
        </li>
      ))}
      {emails.map((email) => (
        <li key={email}>
          <a className="dir-link tap" href={`mailto:${email}`} data-testid="provider-email">
            <bdi dir="ltr" lang="en">
              {email}
            </bdi>
          </a>
        </li>
      ))}
      {webs.map((web) => (
        <li key={web.href}>
          <a className="dir-link tap" href={web.href} target="_blank" rel="noopener noreferrer" data-testid="provider-web">
            <bdi dir="ltr" lang="en">
              {web.text}
            </bdi>
          </a>
        </li>
      ))}
      {social.map((handle) => (
        <li key={handle}>
          <bdi dir="ltr" lang="en">
            {handle}
          </bdi>
        </li>
      ))}
    </ul>
  );
}

/**
 * One provider, as the list shows it (`variant="card"`) and as its own page shows it (`variant="page"`, R-12 and R-13: the
 * pilot's providers are the organisations, so a listing and its organisation are one page). The facts are the same: topics,
 * contacts, day-to-day services, emergency role ("How they can help") and the day the Hub last confirmed them. A detail the
 * file does not give reads "Not known". The machine-translation label and "Read it in English" sit on the card once, and
 * switch every machine-translated text of the card between the page language and its English original.
 */
export function ProviderView({
  provider,
  categories,
  lang,
  variant,
  contentLang,
}: {
  provider: ListingProvider;
  categories: CategoryNames;
  lang: LaunchCode;
  variant: "card" | "page";
  /** The language of the listing's texts when it is not the page's (search results in the language the question was written in). */
  contentLang?: LaunchCode;
}) {
  const t = useTranslations();
  const [english, setEnglish] = useState(false);
  const locale = languageOf(lang).bcp47;
  const addresses = addressLines(provider);
  const nbhds = provider.neighbourhood_ids;
  const nameId = `provider-name-${provider.id}`;
  const names = provider.category_ids.map((id) => categories.get(id)).filter((text): text is ListingText => text !== undefined);
  const machine = machineTexts(provider, categories).length > 0;
  const confirmed = t("directory.lastConfirmed", { date: formatDayText(provider.last_confirmed, isEnglishFallback(t("directory.lastConfirmed")) ? "en-CA" : locale) });
  const Heading = variant === "page" ? "h1" : "h2";

  return (
    <article className={`dir-card dir-card--${variant}`} data-testid={`provider-${provider.id}`} data-provider-id={provider.id}>
      <header className="dir-card__head">
        <Heading className="dir-card__name" id={nameId}>
          {variant === "card" ? (
            <Link href={`/${lang}/directory/${provider.id}`} prefetch={false} className="dir-card__link" data-testid="provider-link">
              <Isolated>{provider.name}</Isolated>
            </Link>
          ) : (
            <Isolated>{provider.name}</Isolated>
          )}
        </Heading>
        {addresses.length > 0 ? (
          addresses.map((line) => (
            <p className="dir-card__address" key={line}>
              <Isolated>{line}</Isolated>
            </p>
          ))
        ) : (
          <p className="dir-card__address">
            <Unknown>{t("status.unknown")}</Unknown>
          </p>
        )}
        <ul className="dir-tags" aria-label={t("directory.topic")}>
          {names.map((name, at) => (
            <li key={`${provider.category_ids[at]}`} className="dir-tag">
              <ListingBlock text={name} english={english} as="span" contentLang={contentLang} />
            </li>
          ))}
          {variant === "page" &&
            provider.subcategories.map((sub) => (
              <li key={sub.body} className="dir-tag dir-tag--quiet">
                <ListingBlock text={sub} english={english} as="span" contentLang={contentLang} />
              </li>
            ))}
          {variant === "page" &&
            nbhds.map((id) => (
              <li key={id} className="dir-tag dir-tag--quiet">
                <Isolated>{neighbourhoodName(id)}</Isolated>
              </li>
            ))}
          {provider.emergency_role && (
            <li className="dir-tag dir-tag--emergency" data-testid="emergency-tag">
              <ResidentText>{t("directory.emergency")}</ResidentText>
            </li>
          )}
        </ul>
        {machine && <MachineLabel english={english} onToggle={() => setEnglish((on) => !on)} describedBy={nameId} />}
      </header>

      <dl className="dir-facts">
        <div className="dir-fact">
          <ResidentText as="dt">{t("R12.services")}</ResidentText>
          <dd data-testid="provider-services">
            <ListingBlock text={provider.services} english={english} contentLang={contentLang} />
          </dd>
        </div>
        <div className="dir-fact">
          <ResidentText as="dt">{t("R12.contact")}</ResidentText>
          <dd data-testid="provider-contact">
            <Contacts provider={provider} />
          </dd>
        </div>
        <div className="dir-fact">
          <ResidentText as="dt">{t("directory.emergencyRole")}</ResidentText>
          <dd data-testid="provider-emergency">{provider.emergency_role ? <HowTheyHelp role={provider.emergency_role} english={english} contentLang={contentLang} /> : <Unknown>{t("status.unknown")}</Unknown>}</dd>
        </div>
      </dl>

      <ResidentText as="p" className="dir-card__confirmed" testId="last-confirmed">
        {confirmed}
      </ResidentText>
    </article>
  );
}
