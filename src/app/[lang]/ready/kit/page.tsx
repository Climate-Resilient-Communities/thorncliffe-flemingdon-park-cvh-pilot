import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLaunchCode } from "@/i18n/languages";
import { ResidentText, Screen, Stack } from "@/ui";
import { Not911 } from "@/ui/emergency";
import type { Translate } from "../../../residentDates";
import "../ready.css";

// The emergency kit (resident testing, session 2, #16: "Be Ready is missing what to have in the emergency kit"). One list shared by
// the six guides: each guide's Before stage links here, and so does Be ready. Its words are the content Helena Yu approved on
// 2026-11-21 (docs/planning/2026-11-18-guide-content-draft.md, "Emergency kit"), kept with the app's other translated words (the
// `kit` namespace), not in the database: it is the same for every guide and every visitor, so the page is prerendered for every
// launch language like Ask for a check-in.

/** The kit's groups, in the order the page shows them. */
export const KIT_GROUPS = ["water", "light", "health", "papers", "family"] as const;

export async function generateMetadata({ params }: PageProps<"/[lang]/ready/kit">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "kit" });
  return { title: t("title") };
}

export default async function KitPage({ params }: PageProps<"/[lang]/ready/kit">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  const kit = await getTranslations({ locale: lang, namespace: "kit" });
  const x01 = (key: "text" | "call" | "short") => t(`x01.${key}`);
  const itemsOf = (group: (typeof KIT_GROUPS)[number]): string[] => {
    const raw = kit.raw(`${group}.items`) as unknown;
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
  };

  return (
    <Screen surface="resident" testId="kit-page">
      <Stack gap="section-resident">
        <Stack gap="related">
          <Link href={`/${lang}/ready`} prefetch={false} className="ready-back tap" data-testid="kit-back">
            <span className="shell-ico shell-ico--back shell-ico--mirror shell-ico--sm" aria-hidden="true" />
            <ResidentText>{t("R24.title")}</ResidentText>
          </Link>
          <ResidentText as="h1" testId="kit-title">
            {kit("title")}
          </ResidentText>
          <ResidentText as="p" testId="kit-intro">
            {kit("intro")}
          </ResidentText>
        </Stack>

        {KIT_GROUPS.map((group) => (
          <section key={group} className="ready-section" aria-labelledby={`kit-${group}-title`} data-testid={`kit-${group}`}>
            <Stack gap="related">
              <h2 id={`kit-${group}-title`} className="guide-heading">
                <ResidentText>{kit(`${group}.title`)}</ResidentText>
              </h2>
              <ul className="guide-steps guide-steps--bullets">
                {itemsOf(group).map((item, index) => (
                  <ResidentText key={index} as="li">
                    {item}
                  </ResidentText>
                ))}
              </ul>
            </Stack>
          </section>
        ))}

        <section className="ready-section" aria-labelledby="kit-help-title" data-testid="kit-help">
          <Stack gap="related">
            <h2 id="kit-help-title" className="guide-heading">
              <ResidentText>{kit("helpTitle")}</ResidentText>
            </h2>
            <ResidentText as="p">{kit("help")}</ResidentText>
            <div>
              <Link href={`/${lang}/directory`} prefetch={false} className="ready-btn ready-btn--secondary tap" data-testid="kit-help-link">
                <ResidentText>{kit("helpLink")}</ResidentText>
              </Link>
            </div>
          </Stack>
        </section>

        <Not911 variant="inline" t={x01} />
      </Stack>
    </Screen>
  );
}
