import type { ReactNode } from "react";
import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";
import { ProcedureLink } from "../ProcedureLink";
import { procedureLink } from "../procedures";
import type { PausedView } from "./view";

const t = (key: string) => englishText(`staff.texts.${key}`);

/**
 * The Pause texts page's body (S06.06), as it is drawn: the heading, what the switch says now, and the form that changes it. While
 * texts are paused it says so with who paused, when and why, how many texts had already been handed to the provider when the pause
 * committed ("and cannot be recalled", the sentence the sending progress view repeats), and that texts to on-call Admins still go out. While
 * they are going out it says what pausing does. `unreadable` is a switch the Hub could not read: the page says so and still offers
 * "Pause all texts", because pressing it when it was already paused changes nothing. No behaviour, so the tests draw the very same markup.
 */
export function TextsView({ paused, unreadable = false, form }: { paused: PausedView | null; unreadable?: boolean; form: ReactNode }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <h1>{t("title")}</h1>
        <p>{t("lead")}</p>
        <ProcedureLink link={procedureLink("pause-and-resume-texts")} />
      </Stack>
      {unreadable ? (
        <p role="alert" className="hub-error" data-testid="texts-unreadable">
          {t("errors.unreadable")}
        </p>
      ) : paused ? (
        <div className="hub-flag" role="status" data-testid="texts-status">
          <Stack gap="subline">
            <p>
              <strong className="hub-flag__label">{paused.heading}</strong>
            </p>
            <p>{paused.by}</p>
            <p>{paused.why}</p>
            {paused.handedOff ? <p data-testid="texts-handed-off">{paused.handedOff}</p> : null}
            <p data-testid="texts-oncall">{paused.oncall}</p>
          </Stack>
        </div>
      ) : (
        <Stack gap="related" testId="texts-status">
          <p role="status">{t("running")}</p>
          <p>{t("whatPauseDoes")}</p>
          <p data-testid="texts-oncall">{t("oncall")}</p>
        </Stack>
      )}
      {form}
    </Stack>
  );
}
