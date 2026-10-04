import Link from "next/link";
import type { LaunchCode } from "@/i18n/languages";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { ResidentText } from "../text/resident-text";
import type { AlertView, Translate } from "./alert-view";
import type { ShareMessage } from "./share-message";
import { ShareActions } from "./share-actions";
import "../shell/icons.css";
import "./alert-icons.css";
import "./share.css";

/**
 * Share an alert (R-29, S05.08), in the prototype's order: back to the alert, the title and what sharing does, "This is what your neighbours will get" over the
 * message itself (the standard version, the same words the phone will send), the two promises (everyone gets this version, nothing tailored to you; the CVH does not
 * record who shares), and the one primary action. The message is drawn from `message.lines`, the very lines the share control sends, so the preview and the text
 * cannot differ. Its first line is the alert's own words, set in the language they are in (English standing in for a translation that failed stays English).
 */
export function ShareScreen({ view, message, lang, t }: { view: AlertView; message: ShareMessage; lang: LaunchCode; t: Translate }) {
  return (
    <Screen surface="resident" testId="share-screen">
      <Stack gap="section-resident">
        <Link className="alert-back tap" href={`/${lang}/alerts/${view.slug}`} prefetch={false} data-testid="share-back">
          <span className="shell-ico shell-ico--back shell-ico--mirror shell-ico--sm" aria-hidden="true" />
          <ResidentText>{t("shell.back")}</ResidentText>
        </Link>

        <Stack gap="subline">
          <ResidentText as="h1" testId="share-title">
            {t("R29.title")}
          </ResidentText>
          <ResidentText as="p" className="hide-basic">{t("R29.lead")}</ResidentText>
        </Stack>

        <section className="alert-section" aria-label={t("R29.preview")} data-testid="share-preview">
          <ResidentText as="p" className="alert-eyebrow" testId="share-preview-title">
            {t("R29.preview")}
          </ResidentText>
          <div className="share-box" data-testid="share-message">
            {message.lines.map((line, index) =>
              index === 0 ? (
                <p className="share-box__line share-box__head" key={index} lang={view.current.text.lang} dir={view.current.text.dir}>
                  {line}
                </p>
              ) : (
                // Each line takes the direction of its own words: an address (Latin letters and digits) in a right-to-left message reads left to right, as a place name does.
                <p className="share-box__line" key={index} dir="auto">
                  {line}
                </p>
              ),
            )}
          </div>
        </section>

        <Stack gap="subline">
          <p className="share-fact alert-strong" data-testid="share-everyone">
            <span className="alert-ico alert-ico--check" aria-hidden="true" />
            <span className="share-fact__text">
              <ResidentText>{t("R29.everyone")}</ResidentText>
            </span>
          </p>
          <p className="share-fact" data-testid="share-not-recorded">
            <span className="alert-ico alert-ico--lock" aria-hidden="true" />
            <span className="share-fact__text">
              <ResidentText>{t("R29.notRecorded")}</ResidentText>
            </span>
          </p>
        </Stack>

        <Stack gap="subline">
          <ShareActions
            text={message.text}
            whatsapp={message.whatsapp}
            labels={{ send: t("R29.send"), copy: t("R29.copy"), copied: t("R29.copied"), copyFailed: t("R29.copyFailed"), whatsapp: t("R29.whatsapp"), noSheet: t("R29.noSheet") }}
          />
          <ResidentText as="p" className="alert-caption hide-basic" testId="share-send-line">
            {t("R29.sendLine")}
          </ResidentText>
        </Stack>
      </Stack>
    </Screen>
  );
}
