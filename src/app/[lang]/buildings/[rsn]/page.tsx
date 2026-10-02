import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ResidentText, Screen, Stack } from "@/ui";
import { isLaunchCode, languageOf } from "@/i18n/languages";
import { loadBuilding } from "./source";
import { buildingPageView, type FactValue, type Translate } from "./view";
import "./building.css";

// A building page is public and the same for every visitor (NFR-N7: the facts, their date and the Hub's contact).
// It is rendered on the first request for a building and language, then served from the cache and rebuilt in the
// background at most every 5 minutes, so the database is asked about a building rarely, not once per visit. When the
// Hub saves a contact (the Admin's building screen), that action drops the cached pages at once. The register's own
// facts change only when the buildings seed runs, so a few minutes of delay costs nothing.
// Nothing is built ahead: the buildings come from the database, which a build does not reach.
export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams(): { rsn: string }[] {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/[lang]/buildings/[rsn]">): Promise<Metadata> {
  const { lang, rsn } = await params;
  if (!isLaunchCode(lang)) return {};
  const building = await loadBuilding(rsn);
  return building ? { title: building.address } : {};
}

/** One fact's value: its words, and a mark that tells "Yes", "No" and "Not known" apart without colour. */
function Value({ value }: { value: FactValue }) {
  switch (value.kind) {
    case "yes":
    case "no":
    case "unknown":
      return (
        <span className={`building-value building-value--${value.kind}`} data-testid={`value-${value.kind}`}>
          <span className="building-value__mark" aria-hidden="true" />
          <ResidentText>{value.text}</ResidentText>
        </span>
      );
    case "number":
      return (
        <bdi dir="ltr" className="building-value building-value--number">
          {value.text}
        </bdi>
      );
    case "register":
      return value.english ? (
        <bdi lang="en" dir="ltr" className="building-value building-value--number">
          {value.text}
        </bdi>
      ) : (
        <span className="building-value building-value--number">
          <ResidentText>{value.text}</ResidentText>
        </span>
      );
  }
}

/**
 * The building page (S02.08, FR-D4-P): the address, then the facts from the City register (storeys, elevators,
 * emergency power, cooling room, air conditioning, barrier-free entrance) with the day they last changed, then the
 * contact the Hub entered. A fact the register does not give reads "Not known", never "No". A building that the
 * latest register no longer lists still opens, with a note that the Hub is checking its details. Only the facts the
 * story lists are read from the database (places' readPublicBuilding).
 */
export default async function BuildingPage({ params }: PageProps<"/[lang]/buildings/[rsn]">) {
  const { lang, rsn } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  const building = await loadBuilding(rsn);
  if (!building) notFound();

  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  const view = buildingPageView(building, t, languageOf(lang).bcp47);
  const { contact } = view;

  return (
    <Screen surface="resident" testId="building-page">
      <Stack gap="section-resident">
        <Stack gap="related">
          <h1 data-testid="building-address">{view.address}</h1>
          <p className="building-neighbourhood">{view.neighbourhood}</p>
          {view.checking && (
            <div className="building-note" role="note" data-testid="building-checking">
              <ResidentText as="p">{view.checking}</ResidentText>
            </div>
          )}
        </Stack>

        <section data-testid="building-register">
          <Stack gap="related">
            <ResidentText as="h2">{view.registerTitle}</ResidentText>
            <ResidentText as="p" className="building-updated" testId="building-updated">
              {view.updated}
            </ResidentText>
            <ResidentText as="p">{view.registerLead}</ResidentText>
            <dl className="building-facts">
              {view.facts.map((fact) => (
                <div className="building-fact" key={fact.id} data-testid={`fact-${fact.id}`}>
                  <ResidentText as="dt">{fact.label}</ResidentText>
                  <dd>
                    <Value value={fact.value} />
                  </dd>
                </div>
              ))}
            </dl>
          </Stack>
        </section>

        <section data-testid="building-contact">
          <Stack gap="related">
            <ResidentText as="h2">{view.contactTitle}</ResidentText>
            {contact.phone && contact.telHref && contact.role ? (
              <Stack gap="label">
                <p>
                  <bdi lang="en" dir="ltr" className="building-contact__role">
                    {contact.role}
                  </bdi>
                </p>
                <a className="tap building-contact__call" href={contact.telHref} data-testid="building-call">
                  <ResidentText>{contact.call}</ResidentText>{" "}
                  <bdi dir="ltr" lang="en">
                    {contact.phone}
                  </bdi>
                </a>
                <ResidentText as="p" className="building-updated" testId="building-contact-provided">
                  {contact.provided ?? ""}
                </ResidentText>
              </Stack>
            ) : (
              <p>
                <span className="building-value building-value--unknown" data-testid="contact-unknown">
                  <span className="building-value__mark" aria-hidden="true" />
                  <ResidentText>{contact.none}</ResidentText>
                </span>
              </p>
            )}
          </Stack>
        </section>
      </Stack>
    </Screen>
  );
}
