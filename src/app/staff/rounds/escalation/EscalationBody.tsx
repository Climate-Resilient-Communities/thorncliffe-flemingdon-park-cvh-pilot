// An escalation's page as it is drawn (S08.08, the follow-up of O-17): its status, building and floor, when and by whom it was marked; a late mark's asks the
// Hub to call the ambassador; for an Admin at aal2 the resident's number (a call link), floor and method while the Hub keeps them, and for anyone else that only
// an Admin sees them; who handled it and their note; and the "Mark handled" form (`form`, which the page gives only to an Admin). Pure: the screenshots and
// the tests render it on a screen they built.
import type { ReactNode } from "react";
import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";
import type { EscalationScreen } from "../view";

const t = (key: string) => englishText(`staff.rounds.escalation.${key}`);

export function EscalationBody({ screen, form }: { screen: EscalationScreen; form?: ReactNode }) {
  const resident = screen.resident;
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <a className="tap hub-link" href={screen.back.href}>
          {screen.back.label}
        </a>
        <h1 className="hub-wrap">{screen.title}</h1>
        <p className="hub-wrap">{screen.marked}</p>
        {screen.late && (
          <p role="note" className="hub-flag hub-wrap" data-testid="escalation-late">
            {screen.late}
          </p>
        )}
      </Stack>
      {resident && (
        <section aria-labelledby="escalation-resident-title" data-testid="escalation-resident">
          <Stack gap="related">
            <h2 id="escalation-resident-title">{t("residentHeading")}</h2>
            {resident.kind === "shown" ? (
              <Stack gap="related">
                <dl>
                  <Stack gap="subline">
                    <div>
                      <dt>{t("phone")}</dt>
                      <dd>
                        <a className="tap hub-link" href={resident.telHref} aria-label={resident.callLabel} data-testid="escalation-phone">
                          {resident.phone}
                        </a>
                      </dd>
                    </div>
                    {resident.language && (
                      <div data-testid="escalation-language">
                        <dt>{t("language")}</dt>
                        <dd>{resident.language}</dd>
                      </div>
                    )}
                    <div>
                      <dt>{t("floor")}</dt>
                      <dd>{resident.floor}</dd>
                    </div>
                    <div>
                      <dt>{t("method")}</dt>
                      <dd>{resident.method}</dd>
                    </div>
                  </Stack>
                </dl>
                <p>
                  <small>{resident.note}</small>
                </p>
              </Stack>
            ) : (
              <p className="hub-wrap" data-testid={`escalation-resident-${resident.kind}`}>
                {resident.text}
              </p>
            )}
          </Stack>
        </section>
      )}
      {screen.handled && (
        <section aria-labelledby="escalation-handled-title" data-testid="escalation-handled">
          <Stack gap="related">
            <h2 id="escalation-handled-title">{t("handledHeading")}</h2>
            <p className="hub-wrap">{screen.handled.line}</p>
            <p className="hub-wrap">{screen.handled.note}</p>
          </Stack>
        </section>
      )}
      {screen.form?.kind === "admin_marks" && <p data-testid="escalation-admin-marks">{screen.form.text}</p>}
      {form}
    </Stack>
  );
}
