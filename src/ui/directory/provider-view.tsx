"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ListingProvider, ListingText } from "@/contracts/directory";
import type { LaunchCode } from "@/i18n/languages";
import { languageOf } from "@/i18n/languages";
import { isEnglishFallback, isEnglishFallbackMessage, ResidentText } from "../text/resident-text";
import { Isolated } from "../text/isolated";
import { Verified } from "../verified/verified";
import { phoneEntries, socialEntries, webEntry } from "./contact";
import { formatDayText } from "./format";
import { HowTheyHelp, ListingBlock } from "./listing-text";
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

/** The English a listing text stands for, compared without case: a topic and a subcategory that say the same thing are one chip. */
const sameChip = (text: ListingText) => text.original.body.trim().toLocaleLowerCase("en");

/**
 * The subcategories the page shows as chips after the topics: one that names the same thing as a topic of the provider, or as a
 * subcategory before it, is left out (production UAT, 2026-10-08: "Non-Profits" showed twice, as a topic and as a subcategory).
 */
export function subcategoryChips(topics: readonly ListingText[], subcategories: readonly ListingText[]): ListingText[] {
  const seen = new Set(topics.map(sameChip));
  return subcategories.filter((sub) => {
    const key = sameChip(sub);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
 * contacts, day-to-day services, emergency role ("How they can help") and, beside the verified badge, the day the Hub last checked them. A detail the
 * file does not give reads "Not known". Every text is shown in the language the release carries it in, with no
 * machine-translation label and no "Read it in English" (product-owner decision 2026-10-09, pilot).
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
  const locale = languageOf(lang).bcp47;
  const addresses = addressLines(provider);
  const nbhds = provider.neighbourhood_ids;
  const nameId = `provider-name-${provider.id}`;
  const names = provider.category_ids.map((id) => categories.get(id)).filter((text): text is ListingText => text !== undefined);
  // An English fallback writes its date in English too, so the line is one language.
  const checkedIsEnglish = isEnglishFallbackMessage(t, "directory.checkedByHub");
  const checked = t("directory.checkedByHub", { date: formatDayText(provider.last_confirmed, checkedIsEnglish ? "en-CA" : locale) });
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
              <ListingBlock text={name} as="span" contentLang={contentLang} />
            </li>
          ))}
          {variant === "page" &&
            subcategoryChips(names, provider.subcategories).map((sub) => (
              <li key={sub.body} className="dir-tag dir-tag--quiet">
                <ListingBlock text={sub} as="span" contentLang={contentLang} />
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
      </header>

      {variant === "card" && phoneEntries(provider.contact.phone).filter((entry) => entry.tel).slice(0, 1).map((entry) => (
        // The card's first number as a call button up front (the full contacts are in the details below), drawn as Contacts draws a call.
        <a key={entry.tel} href={`tel:${entry.tel}`} className="dir-call tap" {...(isEnglishFallback(t("R12.call")) ? { dir: "ltr", lang: "en" } : {})}>
          <ResidentText>{t("R12.call")}</ResidentText>{" "}
          <bdi dir="ltr" lang="en">{entry.text}</bdi>
        </a>
      ))}
      <details className="dir-card__details" open={variant === "page"}>
      <summary className="tap"><ResidentText>{t("R12.services")}</ResidentText></summary>
      <dl className="dir-facts">
        <div className="dir-fact">
          <ResidentText as="dt">{t("R12.services")}</ResidentText>
          <dd data-testid="provider-services">
            <ListingBlock text={provider.services} contentLang={contentLang} />
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
          <dd data-testid="provider-emergency">{provider.emergency_role ? <HowTheyHelp role={provider.emergency_role} contentLang={contentLang} /> : <Unknown>{t("status.unknown")}</Unknown>}</dd>
        </div>
      </dl>
      </details>

      {/* Every listing a resident sees was confirmed by the Hub (unconfirmed providers are never published), so the badge is always the confirmed one. */}
      <Verified as="p" confirmed size={20} className="dir-card__confirmed" testId="last-confirmed" {...(checkedIsEnglish ? { lang: "en", dir: "ltr" as const } : {})}>
        {checked}
      </Verified>
    </article>
  );
}
