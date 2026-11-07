"use client";

// The pieces the place screens share (PRD §6.3): X-03's rules of the space, a heading that takes focus when its step opens, R-21's "Sent to
// the Hub" with the reference code (R-21 for a new place, R-22's sent state for a correction), and the hidden honeypot field.
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import type { LaunchCode } from "@/i18n/languages";
import { Stack } from "../layout/stack";
import { ResidentText } from "../text/resident-text";

/** X-03 in one language, as the page reads it from that language's catalog (R-18 can show the rules in a language other than the page's). */
export interface RulesTexts {
  title: string;
  intro: string;
  rules: string[];
  market: string;
  review: string;
}

/** X-03 "The rules of this space", full: in its own language when R-18 shows it in another. */
export function RulesCard({ texts, lang, dir }: { texts: RulesTexts; lang?: string; dir?: "ltr" | "rtl" }) {
  return (
    <section className="places-card" aria-labelledby="places-rules-title" lang={lang} dir={dir} data-testid="places-rules">
      <Stack gap="related">
        <h2 id="places-rules-title">
          <ResidentText>{texts.title}</ResidentText>
        </h2>
        <ResidentText as="p">{texts.intro}</ResidentText>
        <Stack as="ul" gap="label">
          {texts.rules.map((rule) => (
            <ResidentText key={rule} as="li">
              {rule}
            </ResidentText>
          ))}
        </Stack>
        <ResidentText as="p" className="places-market">
          {texts.market}
        </ResidentText>
        <ResidentText as="p" className="choice-hint">
          {texts.review}
        </ResidentText>
      </Stack>
    </section>
  );
}

/** A step's heading: focused when the step opens, so a screen reader starts there and the page is at its top. */
export function StepHeading({ children, testId }: { children: string; testId?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: false });
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} data-testid={testId}>
      <ResidentText>{children}</ResidentText>
    </h1>
  );
}

/** "Back": a button inside a flow, a link out of it. */
export function Back({ onClick, href }: { onClick?: () => void; href?: string }) {
  const t = useTranslations("shell");
  if (href) {
    return (
      <Link className="choice-btn choice-btn--quiet tap" href={href} prefetch={false} data-testid="places-back">
        <ResidentText>{t("back")}</ResidentText>
      </Link>
    );
  }
  return (
    <button type="button" className="choice-btn choice-btn--quiet tap" onClick={onClick} data-testid="places-back">
      <ResidentText>{t("back")}</ResidentText>
    </button>
  );
}

/**
 * The honeypot (src/contracts/placeSubmission.ts): a field no person sees, reaches by Tab or hears; a script that fills every input fills it,
 * and its suggestion is answered like any other and stored nowhere.
 */
export function Honeypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("places");
  return (
    <div className="places-honeypot" aria-hidden="true">
      <label htmlFor="places-nickname">{t("honeypot")}</label>
      <input id="places-nickname" name="nickname" type="text" tabIndex={-1} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

/** The reference code and how to come back with it: written down, or the link to what the Hub decided (R-23). */
export function Reference({ lang, code }: { lang: LaunchCode; code: string }) {
  const t = useTranslations("places");
  return (
    <section className="places-card places-card--key" aria-labelledby="places-ref-title" data-testid="places-reference">
      <Stack gap="related">
        <h2 id="places-ref-title">
          <ResidentText>{t("ref")}</ResidentText>
        </h2>
        <p className="places-ref" dir="ltr" lang="en" data-testid="places-ref">
          {code}
        </p>
        <ResidentText as="p">{t("refHint")}</ResidentText>
        <Link className="choice-btn choice-btn--secondary tap" href={`/${lang}/places/submitted/${code}`} prefetch={false} data-testid="places-check-status">
          <ResidentText>{t("checkStatus")}</ResidentText>
        </Link>
      </Stack>
    </section>
  );
}

/** R-21: sent, which lane (residents are always on the general one: the CVH does not know who an ambassador is), how long, the code, what next. */
export function SentPanel({ lang, title, lead, code, children, actions }: { lang: LaunchCode; title: string; lead: string; code: string; children?: ReactNode; actions: ReactNode }) {
  const t = useTranslations();
  return (
    <Stack gap="section-resident" testId="places-sent">
      <Stack gap="related">
        <StepHeading testId="places-sent-title">{title}</StepHeading>
        {lead && (
          <ResidentText as="p" className="signup-lead">
            {lead}
          </ResidentText>
        )}
      </Stack>
      {children}
      <section className="places-card places-card--key" aria-labelledby="places-lane-title">
        <Stack gap="related">
          <h2 id="places-lane-title">
            <ResidentText>{t("R21.lane", { lane: t("R21.laneGeneral") })}</ResidentText>
          </h2>
          <p>
            <span className="places-label">
              <ResidentText>{t("R21.howLong")}</ResidentText>
            </span>{" "}
            <ResidentText>{t("R21.weekLine")}</ResidentText>
          </p>
          <ResidentText as="p">{t("places.sentLine")}</ResidentText>
        </Stack>
      </section>
      <Reference lang={lang} code={code} />
      <section aria-labelledby="places-next-title">
        <Stack gap="related">
          <h2 id="places-next-title">
            <ResidentText>{t("R21.next")}</ResidentText>
          </h2>
          <Stack as="ol" gap="label">
            {(["n1", "n2", "n3"] as const).map((key) => (
              <ResidentText key={key} as="li">
                {t(`R21.${key}`)}
              </ResidentText>
            ))}
          </Stack>
        </Stack>
      </section>
      <div className="choice-actions">{actions}</div>
    </Stack>
  );
}
