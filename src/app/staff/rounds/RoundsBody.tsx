// "Check-in rounds" as it is drawn (O-17, S08.08): the escalations to follow up first, each with its status, building and floor, when it was marked and by
// which ambassador (a late mark's says to call the ambassador), then those handled in the last 7 days; S08.09: then the rounds' counts by building and
// floor (RoundProgress), for the roles that see counts. Pure: the screenshots and the tests render it on a screen they built, and the page on the escalations
// and counts read now. No resident's number is on this page.
import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";
import type { ProgressScreen } from "./progress";
import { RoundProgress } from "./RoundProgress";
import type { EscalationItemView, RoundsScreen } from "./view";

const t = (key: string) => englishText(`staff.rounds.${key}`);

function Item({ item, handled = false }: { item: EscalationItemView; handled?: boolean }) {
  // A card per escalation (the prototype's O-17): what the ambassador found as a pill with the time at the end, then where, who marked it and
  // the late note; the danger bar for needs help, the accent bar for not reached, a plain one once it is handled. Words, never colour alone.
  const tone = handled ? "handled" : item.status;
  return (
    <li className={`hub-esc hub-esc--${tone}`} data-testid="escalation-item" data-status={item.status}>
      <Stack gap="subline">
        <div className="hub-esc__head">
          <span className={`hub-pill hub-pill--${item.status}`}>{item.statusLabel}</span>
          <span className="hub-esc__time hub-wrap">{item.marked}</span>
        </div>
        <p className="hub-esc__where hub-wrap">{item.where}</p>
        <p className="hub-wrap">{item.from}</p>
        {item.late && (
          <p className="hub-flag hub-wrap" data-testid="escalation-late">
            {item.late}
          </p>
        )}
        {item.handled && <p className="hub-wrap">{item.handled}</p>}
        <a className="tap hub-button hub-button--secondary hub-esc__open" href={item.href} aria-label={item.openLabel} data-testid="escalation-open">
          {t("open")}
        </a>
      </Stack>
    </li>
  );
}

/** `progress`: the rounds' counts (S08.09), or null for a role that does not see counts (`coverage.view`). */
export function RoundsBody({ screen, progress }: { screen: RoundsScreen; progress: ProgressScreen | null }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <h1 className="hub-wrap">{t("title")}</h1>
        <p>{t("lead")}</p>
        <p>
          <small>{t("refresh")}</small>
        </p>
      </Stack>
      {screen.unreadable ? (
        <p role="alert" className="hub-error" data-testid="rounds-unreadable">
          {t("unreadable")}
        </p>
      ) : (
        <>
          <section aria-labelledby="escalations-open-title" data-testid="escalations-open">
            <Stack gap="related">
              <h2 id="escalations-open-title" className="hub-wrap">
                {t("followUp")}
              </h2>
              {screen.open.length === 0 ? (
                <p role="status" data-testid="escalations-none">
                  {t("noneWaiting")}
                </p>
              ) : (
                <Stack as="ul" gap="related">
                  {screen.open.map((item) => (
                    <Item key={item.id} item={item} />
                  ))}
                </Stack>
              )}
            </Stack>
          </section>
          <section aria-labelledby="escalations-handled-title" data-testid="escalations-handled">
            <Stack gap="related">
              <h2 id="escalations-handled-title" className="hub-wrap">
                {t("handledHeading")}
              </h2>
              {screen.handled.length === 0 ? (
                <p>{t("noneHandled")}</p>
              ) : (
                <Stack as="ul" gap="related">
                  {screen.handled.map((item) => (
                    <Item key={item.id} item={item} handled />
                  ))}
                </Stack>
              )}
            </Stack>
          </section>
        </>
      )}
      {progress !== null && <RoundProgress progress={progress} />}
      {!screen.unreadable && (
        <p>
          <small>{t("numberNote")}</small>
        </p>
      )}
    </Stack>
  );
}
