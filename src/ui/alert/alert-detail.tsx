import Link from "next/link";
import type { LaunchCode } from "@/i18n/languages";
import { Not911 } from "../emergency";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { ResidentText } from "../text/resident-text";
import type { AlertView, Translate } from "./alert-view";
import { DisruptionTypes, EntryText, OriginMark, ThreadEntryText } from "./alert-parts";
import "../shell/icons.css";
import "./alert-icons.css";

/**
 * Alert detail (R-07, S04.08). In the order the prototype fixes (brief 3.1.1): what kind of disruption (X-13), the words of the alert, where
 * they came from and whether the Hub checked them (X-02, with the link to what "verified" means, R-28), when it was posted and how long it
 * is valid, then the 911 block (X-01), what to do (the guide that matches, opened at "During"), and every entry of the thread, newest first.
 * A machine translation carries its label and "Read it in English" (X-04); English standing in for a translation that failed says so in the
 * resident's language. The 911 block is the one catalog component (AD-16), here once, in its full form.
 */
export function AlertDetail({ view, lang, t }: { view: AlertView; lang: LaunchCode; t: Translate }) {
  const x01 = (key: "text" | "call" | "short") => t(`x01.${key}`);
  return (
    <Screen surface="resident" testId="alert-detail">
      <Stack gap="section-resident">
        <Link className="alert-back tap" href={`/${lang}`} prefetch={false} data-testid="alert-back">
          <span className="shell-ico shell-ico--back shell-ico--mirror shell-ico--sm" aria-hidden="true" />
          <ResidentText>{t("shell.back")}</ResidentText>
        </Link>

        <article className="alert-article" data-testid="alert-article" data-slug={view.slug}>
          <DisruptionTypes types={view.types} size="lg" heading />
          {view.closed !== null && (
            <div className="alert-note" role="note" data-testid="alert-closed" data-reason={view.closed.reason}>
              <span className={`alert-ico alert-ico--${view.closed.icon}`} aria-hidden="true" />
              <div className="alert-note__body">
                <ResidentText as="p" className="alert-note__title" testId="alert-closed-title">
                  {view.closed.title}
                </ResidentText>
                <ResidentText as="p" testId="alert-closed-line">
                  {view.closed.line}
                </ResidentText>
              </div>
            </div>
          )}
          {view.ended !== null && (
            <div className="alert-note" role="note" data-testid="alert-ended">
              <ResidentText as="p">{view.ended}</ResidentText>
            </div>
          )}
          <EntryText view={view} entry={view.current} />
          <OriginMark origin={view.origin} href={`/${lang}/alerts/${view.slug}/verified`} />
          <Stack gap="subline">
            <ResidentText as="p" className="alert-caption" testId="alert-times">
              {view.times}
            </ResidentText>
            {view.valid !== null && (
              <ResidentText as="p" className="alert-caption" testId="alert-valid">
                {view.valid}
              </ResidentText>
            )}
          </Stack>
        </article>

        <Not911 variant="block" t={x01} />

        {view.guides.length > 0 && (
          <section className="alert-actions" aria-label={t("R07.whatToDo")} data-testid="alert-actions">
            {view.guides.map((guide) => (
              <Link className="alert-dest tap" href={guide.href} prefetch={false} key={guide.id} data-testid={`alert-guide-${guide.id}`}>
                {/* A guide's id is the name of its icon in the shell's set (a test keeps them so). */}
                <span className={`shell-ico shell-ico--${guide.id}`} aria-hidden="true" />
                <span className="alert-dest__label">
                  <ResidentText>{guide.label}</ResidentText>
                </span>
                <span className="shell-ico shell-ico--chevron shell-ico--mirror" aria-hidden="true" />
              </Link>
            ))}
          </section>
        )}

        {/* Share (R-29, S05.08): the one step to the message a neighbour gets, for an open alert and for one that closed. */}
        <div className="alert-actions" data-testid="alert-share-actions">
          <Link className="alert-dest tap" href={`/${lang}/alerts/${view.slug}/share`} prefetch={false} data-testid="alert-share">
            <span className="alert-ico alert-ico--share shell-ico--mirror" aria-hidden="true" />
            <span className="alert-dest__label">
              <ResidentText>{t("R07.share")}</ResidentText>
            </span>
            <span className="shell-ico shell-ico--chevron shell-ico--mirror" aria-hidden="true" />
          </Link>
        </div>

        {view.entries.length > 1 && (
          <section className="alert-section" aria-labelledby="alert-thread-title" data-testid="alert-thread">
            <ResidentText as="h2" testId="alert-thread-title">
              {t("R07.thread")}
            </ResidentText>
            <ol className="alert-thread">
              {view.entries.map((entry, index) => (
                <li
                  className={`alert-entry${index === 0 ? " alert-entry--latest" : ""}${entry.mark ? ` alert-entry--${entry.mark.kind}` : ""}`}
                  key={entry.id}
                  data-testid={`alert-entry-${entry.id}`}
                  data-mark={entry.mark?.kind}
                >
                  <span className="alert-entry__kind">
                    <ResidentText>{entry.kindLabel}</ResidentText>
                    {index === 0 && (
                      <span className="alert-tag">
                        <ResidentText>{t("R07.latestTag")}</ResidentText>
                      </span>
                    )}
                    <span className="alert-entry__time">
                      <ResidentText>{entry.time}</ResidentText>
                    </span>
                    {entry.phase !== null && (
                      <span className="alert-entry__phase" data-testid={`alert-entry-phase-${entry.id}`}>
                        <ResidentText>{entry.phase}</ResidentText>
                      </span>
                    )}
                  </span>
                  {entry.mark && (
                    <span className={`alert-mark alert-mark--${entry.mark.kind}`} data-testid={`alert-entry-mark-${entry.id}`}>
                      <span className={`alert-ico alert-ico--${entry.mark.kind === "corrected" ? "corrected" : "info"} alert-ico--sm`} aria-hidden="true" />
                      <ResidentText>{entry.mark.label}</ResidentText>
                    </span>
                  )}
                  <ThreadEntryText view={view} entry={entry} latest={index === 0} />
                </li>
              ))}
            </ol>
          </section>
        )}
      </Stack>
    </Screen>
  );
}
