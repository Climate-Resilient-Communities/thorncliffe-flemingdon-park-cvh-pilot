// The moderation queue as it is drawn (O-08, PRD §6.3): how many wait, the oldest and how many are past the week residents are told, then a card
// per waiting suggestion, oldest first, with its type, what they wrote, the language, how long it has waited and the queue's flags, then what was
// decided in the last 14 days. Pure: the tests render it on a screen they built. Words carry every state (an overdue card also says so).
import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";
import type { QueueRowView, QueueScreen } from "./view";

const t = (key: string) => englishText(`staff.moderation.${key}`);
const o8 = (key: string) => englishText(`O08.${key}`);

function Row({ row }: { row: QueueRowView }) {
  return (
    <li className={row.overdue ? "hub-esc hub-esc--not_reached" : "hub-esc"} data-testid="moderation-row">
      <Stack gap="subline">
        <div className="hub-esc__head">
          <span className="hub-pill">{row.typeLabel}</span>
          <span className="hub-esc__time hub-wrap">
            {row.waited} · {row.due}
          </span>
        </div>
        <p className="hub-esc__where hub-wrap">{row.name}</p>
        {row.gloss && <p className="hub-wrap">{row.gloss}</p>}
        <p className="hub-wrap">
          <small>
            {o8("cols.lang")}: {row.language} · {row.ref}
          </small>
        </p>
        {row.flags.length > 0 && (
          <p className="hub-flag hub-wrap" data-testid="moderation-flags">
            {row.flags.join(" · ")}
          </p>
        )}
        <a className="tap hub-button hub-button--secondary hub-esc__open" href={row.href} aria-label={row.reviewLabel} data-testid="moderation-review">
          {o8("review")}
        </a>
      </Stack>
    </li>
  );
}

export function QueueBody({ screen, readOnly }: { screen: QueueScreen | null; readOnly: boolean }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <h1 className="hub-wrap">{t("title")}</h1>
        <p>{t("lead")}</p>
        {readOnly && (
          <p role="note" className="hub-flag hub-wrap" data-testid="moderation-read-only">
            {t("readOnly")}
          </p>
        )}
      </Stack>
      {screen === null ? (
        <p role="alert" className="hub-error" data-testid="moderation-unreadable">
          {t("unreadable")}
        </p>
      ) : (
        <>
          <ul className="hub-stats" aria-label={t("waitingTitle")}>
            <li className="hub-stat">
              <span className="hub-stat__n">{screen.waitingCount}</span>
              <span className="hub-stat__label">{o8("waitingN")}</span>
            </li>
            <li className="hub-stat">
              <span className="hub-stat__n">{screen.oldest}</span>
              <span className="hub-stat__label">{o8("oldestK")}</span>
            </li>
            {/* Past the week residents are told: shown only when there is one, as the catalog's whole sentence ("2 overdue in all"). */}
            {screen.overdueCount > 0 && (
              <li className="hub-stat hub-stat--alert" data-testid="moderation-overdue">
                <strong className="hub-stat__label">{screen.overdueCount === 1 ? o8("overdueOneAll") : englishText("O08.overdueN", { n: screen.overdueCount })}</strong>
              </li>
            )}
          </ul>
          <section aria-labelledby="moderation-waiting-title" data-testid="moderation-waiting">
            <Stack gap="related">
              <h2 id="moderation-waiting-title" className="hub-wrap">
                {t("waitingTitle")}
              </h2>
              {screen.rows.length === 0 ? (
                <div role="status" data-testid="moderation-empty">
                  <p>
                    <strong>{o8("emptyTitle")}</strong>
                  </p>
                  <p>{o8("emptyLine")}</p>
                </div>
              ) : (
                <Stack as="ul" gap="related">
                  {screen.rows.map((row) => (
                    <Row key={row.id} row={row} />
                  ))}
                </Stack>
              )}
            </Stack>
          </section>
          <section aria-labelledby="moderation-decided-title" data-testid="moderation-decided">
            <Stack gap="related">
              <h2 id="moderation-decided-title" className="hub-wrap">
                {t("decidedTitle")}
              </h2>
              {screen.decided.length === 0 ? (
                <p>{t("noneDecided")}</p>
              ) : (
                <Stack as="ul" gap="related">
                  {screen.decided.map((row) => (
                    <li key={row.id} className="hub-list-item" data-testid="moderation-decided-row">
                      <Stack gap="subline">
                        <a className="tap hub-link hub-wrap" href={row.href}>
                          {row.name}
                        </a>
                        <p className="hub-wrap">
                          {row.typeLabel} · {row.decision}
                        </p>
                      </Stack>
                    </li>
                  ))}
                </Stack>
              )}
            </Stack>
          </section>
        </>
      )}
    </Stack>
  );
}
