// One suggestion as it is drawn (O-09, PRD §6.3): the way back to the queue, its type, who it is from and when, then what the resident wrote (in
// their language, marked as such), their answers (a missing one flagged, a "Not sure" marked), for a correction the place as the Hub lists it
// now, "Before you decide", its decision once made, and the decision forms (`decide`, given by the page for the roles that may decide). Pure.
import type { ReactNode } from "react";
import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";
import { MODERATION_PAGE, type AnswerRow, type ReviewScreen } from "../view";

const o9 = (key: string) => englishText(`O09.${key}`);

function Answers({ rows, testId }: { rows: readonly AnswerRow[]; testId: string }) {
  return (
    <dl className="hub-wrap" data-testid={testId}>
      {rows.map((row) => (
        <div key={row.label} className="hub-list-item">
          <dt>
            <strong>{row.label}</strong>
          </dt>
          <dd>
            {row.tone === "missing" ? <span className="hub-flag">{row.value}</span> : row.tone === "notSure" ? <em>{row.value}</em> : row.value}
            {row.link && (
              <>
                {" "}
                <a className="tap hub-link" href={row.link.href} target="_blank" rel="noopener noreferrer">
                  {row.link.label}
                </a>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ReviewBody({ screen, decide, readOnly }: { screen: ReviewScreen; decide: ReactNode; readOnly: string | null }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <a className="tap hub-link" href={MODERATION_PAGE} data-testid="moderation-back">
          {o9("back")}
        </a>
        <p className="hub-wrap">
          <span className="hub-pill">{screen.typeLabel}</span> {screen.from}
        </p>
        <h1 className="hub-wrap">{screen.name}</h1>
        <p className="hub-wrap">
          <small>
            {screen.meta}
            {screen.position && <> · {screen.position}</>}
          </small>
        </p>
      </Stack>
      {screen.wrote && (
        <section aria-labelledby="review-wrote-title">
          <Stack gap="related">
            <h2 id="review-wrote-title">{o9("wroteTitle")}</h2>
            <p className="hub-resident-words hub-wrap" lang={screen.wrote.lang} dir="auto" data-testid="review-wrote">
              {screen.wrote.text}
            </p>
            {screen.wrote.english && (
              <p>
                <small>{o9("writtenEn")}</small>
              </p>
            )}
          </Stack>
        </section>
      )}
      <section aria-labelledby="review-answers-title">
        <Stack gap="related">
          <h2 id="review-answers-title">{screen.listed ? o9("k.changed") : o9("answersTitle")}</h2>
          <Answers rows={screen.rows} testId="review-answers" />
        </Stack>
      </section>
      {screen.listed && (
        <section aria-labelledby="review-listed-title" data-testid="review-listed">
          <Stack gap="related">
            <h2 id="review-listed-title">{o9("k.now")}</h2>
            {screen.listed.note && <p className="hub-flag hub-wrap">{screen.listed.note}</p>}
            {screen.listed.rows.length > 0 && <Answers rows={screen.listed.rows} testId="review-listed-rows" />}
          </Stack>
        </section>
      )}
      {screen.checks.length > 0 && (
        <section aria-labelledby="review-checks-title">
          <Stack gap="related">
            <h2 id="review-checks-title">{o9("checksTitle")}</h2>
            <Stack as="ul" gap="subline">
              {screen.checks.map((check) => (
                <li key={check} className="hub-wrap">
                  {check}
                </li>
              ))}
            </Stack>
          </Stack>
        </section>
      )}
      {screen.decision && (
        <p className="hub-flag hub-wrap" role="status" data-testid="review-decision">
          {screen.decision}
        </p>
      )}
      {readOnly && screen.status === "pending" && (
        <p role="note" className="hub-wrap" data-testid="moderation-read-only">
          {readOnly}
        </p>
      )}
      {decide}
    </Stack>
  );
}
