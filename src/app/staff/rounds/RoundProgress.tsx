// The rounds' counts by building and floor as they are drawn on "Check-in rounds" (O-17, S08.09): each open round's live counts, then each round closed in
// the last 7 days with the counts kept of it. Each round is a card: its counts in all as tiles, then each building's floors as a table (UAT 2026-11-04:
// "it shouldn't just be unformatted text"). Pure: the
// screenshots and the tests render it on counts they built, and the page on the counts read now. Counts only: no number is on this page.
import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";
import type { ProgressBuilding, ProgressCount, ProgressRound, ProgressScreen } from "./progress";

const t = (key: string) => englishText(`staff.rounds.progress.${key}`);

/** A round's counts in all: one tile each, the number large and its name under it; the ones that need someone first, warm when there are any. */
function Totals({ counts }: { counts: readonly ProgressCount[] }) {
  const urgent = (status: string) => status === "needs_help" || status === "not_reached";
  const ordered = [...counts.filter((c) => urgent(c.status)), ...counts.filter((c) => !urgent(c.status))];
  return (
    <ul className="hub-stats">
      {ordered.map((count) => (
        <li key={count.status} className={`hub-stat${urgent(count.status) && count.n > 0 ? " hub-stat--alert" : ""}`} data-count={count.status} data-n={count.n}>
          <span className="hub-stat__n" aria-hidden="true">
            {count.n}
          </span>
          <span className="hub-stat__label" aria-hidden="true">
            {count.label}
          </span>
          <span className="sr-only">{count.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One building's floors: a table, one row a floor and one column a count (numbers end-aligned), so the rounds read across at 1280 px; it
 * scrolls inside its own box at 390 px rather than the page. Each cell's number keeps the count's name for a screen reader (its column).
 */
function FloorTable({ building }: { building: ProgressBuilding }) {
  const columns = building.floors[0]?.counts ?? [];
  return (
    <div className="hub-table-box" role="region" aria-label={building.address} tabIndex={0}>
      <table className="hub-table" data-testid="progress-table">
        <thead>
          <tr>
            <th scope="col">{t("floorColumn")}</th>
            {columns.map((count) => (
              <th key={count.status} scope="col" className="hub-table__n">
                {count.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {building.floors.map((floor) => (
            <tr key={floor.key} data-testid="progress-floor">
              <th scope="row" className="hub-wrap">
                {floor.label}
              </th>
              {floor.counts.map((count) => (
                <td key={count.status} className="hub-table__n" data-count={count.status} data-n={count.n}>
                  {count.n}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Round({ round, kind }: { round: ProgressRound; kind: "open" | "closed" }) {
  return (
    <div className={`hub-round${kind === "closed" ? " hub-round--closed" : ""}`} data-testid={`progress-${kind}-round`}>
      <Stack gap="related">
        <h3 className="hub-wrap hub-preline">{round.title}</h3>
        <Stack gap="subline" testId="progress-total">
          <p className="hub-wrap">
            <strong>{t("total")}</strong>
          </p>
          <Totals counts={round.total} />
        </Stack>
        {round.buildings.map((building) => (
          <Stack key={building.rsn} gap="label" testId="progress-building">
            <h4 className="hub-round__building hub-wrap">{building.address}</h4>
            <FloorTable building={building} />
          </Stack>
        ))}
      </Stack>
    </div>
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
