// The rounds' counts by building and floor as they are drawn on "Check-in rounds" (O-17, S08.09): each open round's live counts, then each round closed in
// the last 7 days with the counts kept of it. Every floor is a list item with its counts, so the page reads the same at 390 px and 1280 px. Pure: the
// screenshots and the tests render it on counts they built, and the page on the counts read now. Counts only: no number is on this page.
import { englishText } from "@/i18n/text";
import { Inline, Stack } from "@/ui";
import type { ProgressCount, ProgressRound, ProgressScreen } from "./progress";

const t = (key: string) => englishText(`staff.rounds.progress.${key}`);

function Counts({ counts }: { counts: readonly ProgressCount[] }) {
  return (
    <Inline gap="related" wrap>
      {counts.map((count) => (
        <span key={count.status} className="hub-wrap" data-count={count.status} data-n={count.n}>
          {count.text}
        </span>
      ))}
    </Inline>
  );
}

function Round({ round, kind }: { round: ProgressRound; kind: "open" | "closed" }) {
  return (
    <Stack gap="related" testId={`progress-${kind}-round`}>
      <h3 className="hub-wrap hub-preline">{round.title}</h3>
      <Stack gap="subline" testId="progress-total">
        <p className="hub-wrap">
          <strong>{t("total")}</strong>
        </p>
        <Counts counts={round.total} />
      </Stack>
      {round.buildings.map((building) => (
        <Stack key={building.rsn} gap="related" testId="progress-building">
          <h4 className="hub-wrap">
            <strong>{building.address}</strong>
          </h4>
          <Stack as="ul" gap="related">
            {building.floors.map((floor) => (
              <li key={floor.key} className="hub-list-item" data-testid="progress-floor">
                <Stack gap="subline">
                  <p className="hub-wrap">
                    <strong>{floor.label}</strong>
                  </p>
                  <Counts counts={floor.counts} />
                </Stack>
              </li>
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}

export function RoundProgress({ progress }: { progress: ProgressScreen }) {
  return (
    <>
      <section aria-labelledby="progress-open-title" data-testid="progress-open">
        <Stack gap="related">
          <h2 id="progress-open-title" className="hub-wrap">
            {t("heading")}
          </h2>
          {progress.unreadable ? (
            <p role="alert" className="hub-error" data-testid="progress-unreadable">
              {t("unreadable")}
            </p>
          ) : (
            <>
              <p className="hub-wrap">{t("lead")}</p>
              {progress.open.length === 0 ? (
                <p role="status" className="hub-wrap" data-testid="progress-none">
                  {t("none")}
                </p>
              ) : (
                progress.open.map((round) => <Round key={round.alertId} round={round} kind="open" />)
              )}
            </>
          )}
        </Stack>
      </section>
      {!progress.unreadable && (
        <section aria-labelledby="progress-closed-title" data-testid="progress-closed">
          <Stack gap="related">
            <h2 id="progress-closed-title" className="hub-wrap">
              {t("closedHeading")}
            </h2>
            <p className="hub-wrap">{t("closedLead")}</p>
            {progress.closedCut !== null && (
              <p className="hub-wrap" data-testid="progress-closed-cut">
                {progress.closedCut}
              </p>
            )}
            {progress.closed.length === 0 ? (
              <p className="hub-wrap" data-testid="progress-closed-none">
                {t("closedNone")}
              </p>
            ) : (
              progress.closed.map((round) => <Round key={round.alertId} round={round} kind="closed" />)
            )}
          </Stack>
        </section>
      )}
    </>
  );
}
