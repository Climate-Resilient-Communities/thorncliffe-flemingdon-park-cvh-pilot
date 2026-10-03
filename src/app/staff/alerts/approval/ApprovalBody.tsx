"use client";

import { useActionState, useState } from "react";
import { Grid, Inline, Screen, Stack } from "@/ui";
import type { ApprovalState } from "./approveFromForm";
import { confirmedCount } from "./countConfirmation";
import type { ApprovalScreen, LanguageReviewView } from "./view";

/** An approval form's server action (actions.ts): the form's last state and its data in, the new state out. */
export type ApprovalAction = (previous: ApprovalState, form: FormData) => Promise<ApprovalState>;

export interface ApprovalActions {
  approve: ApprovalAction;
  returnToAuthor: ApprovalAction;
  discard: ApprovalAction;
}

const IDLE: ApprovalState = { status: "idle" };
const APPROVE_FORM = "approve-form";
const RETURN_FORM = "return-form";
const DISCARD_FORM = "discard-form";

/** Test seam: the screen already in the state a press reaches (the screenshots show them). */
export interface ApprovalInitial {
  mode?: "return" | "discard";
  approve?: ApprovalState;
  returnToAuthor?: ApprovalState;
}

/** Replaces `{name}` in a string the server left as a template. */
const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));

function Problem({ id, message }: { id: string; message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="hub-error" data-testid={id}>
      {message}
    </p>
  );
}

/** The entry the forms are about, and what the approver was shown of it: every form names them, so a changed entry is refused. */
function Bound({ screen, reviewed }: { screen: ApprovalScreen; reviewed?: string }) {
  return (
    <>
      <input type="hidden" name="alert" value={screen.ref.alertId} />
      <input type="hidden" name="entry" value={screen.ref.entryId} />
      <input type="hidden" name="version" value={screen.binding.version} />
      <input type="hidden" name="hash" value={screen.binding.contentHash} />
      {reviewed !== undefined && <input type="hidden" name="reviewed" value={reviewed} />}
    </>
  );
}

function LanguageItem({ row, webLabel }: { row: LanguageReviewView; webLabel: string }) {
  return (
    <li className="hub-list-item" data-testid={`language-${row.lang}`} data-state={row.fallback ? "fallback_en" : "ok"}>
      <details>
        <summary className="tap hub-summary">
          <span className="hub-wrap">
            <strong lang={row.bcp47} dir={row.dir}>
              {row.native}
            </strong>
            {row.native === row.english ? "" : ` ${row.english}`} · {row.state}
          </span>
        </summary>
        <Stack gap="related">
          {row.web !== null && (
            <div>
              <p>
                <strong>{webLabel}</strong>
              </p>
              <p className="hub-wrap hub-prewrap" lang={row.bcp47} dir={row.dir} data-testid={`web-${row.lang}`}>
                {row.web}
              </p>
            </div>
          )}
          {row.sms ? (
            <div>
              <p className="hub-wrap">
                <strong>{row.sms.summary}</strong>
              </p>
              <p className="hub-wrap hub-prewrap" lang={row.bcp47} dir={row.dir} data-testid={`sms-${row.lang}`}>
                {row.sms.body}
              </p>
            </div>
          ) : null}
          {row.recipients && <p className="hub-wrap">{row.recipients}</p>}
        </Stack>
      </details>
    </li>
  );
}

/**
 * The approval view (O-05 an alert, O-07 an ambassador's post, S04.07). One screen with two states: an entry waiting for a second person (the text and
 * what goes out, every other language one tap away, and the three actions), and an entry that is not waiting for this person (what became of it).
 *
 * Below 800 px of content width it is one column, the main content first (the English text, the audience in words, the channels, the number of
 * text message recipients, the estimated cost, the valid-until and any language that fell back) and the aside after it (every other language, one
 * tap away); from 800 px two columns. The actions are in the sticky actions region at the block end in both, so Approve is within thumb reach.
 *
 * Approve names the version and hash that were shown and the number of people the text reaches as it was counted when the page loaded. If the
 * number changed by the time the approval ran, nothing is approved: the new number per language and its cost are shown, and the approver
 * confirms them before approving. There is never an "edit and approve": whoever edits becomes an editor and cannot approve.
 */
export function ApprovalBody({ screen, actions, initial }: { screen: ApprovalScreen; actions: ApprovalActions; initial?: ApprovalInitial }) {
  const [approveState, approveAction, approving] = useActionState(actions.approve, initial?.approve ?? IDLE);
  const [returnState, returnAction, returning] = useActionState(actions.returnToAuthor, initial?.returnToAuthor ?? IDLE);
  const [discardState, discardAction, discarding] = useActionState(actions.discard, IDLE);
  const [mode, setMode] = useState<"return" | "discard" | null>(initial?.mode ?? null);
  // The state the approver ticked the confirmation for: an answer that says the number changed again is a new state, so it starts unconfirmed.
  const [confirmedFor, setConfirmedFor] = useState<ApprovalState | null>(null);
  const [note, setNote] = useState("");

  const changed = approveState.status === "count_changed" ? approveState.view : null;
  const confirmed = confirmedCount(confirmedFor, approveState);
  const busy = approving || returning || discarding;
  const problem = [approveState, returnState, discardState].map((state) => (state.status === "refused" ? state.message : null)).find((message) => message !== null) ?? null;
  const over = [...note].length > screen.returnForm.max;

  const bar =
    screen.status !== "review" ? undefined : mode === null ? (
      <Inline gap="target" wrap>
        <button
          className="hub-button hub-button--primary"
          type="submit"
          form={APPROVE_FORM}
          disabled={busy || (changed !== null && !confirmed)}
          data-testid="approve-button"
        >
          {changed ? screen.actions.approveConfirmed : screen.actions.approve}
        </button>
        <button className="hub-button hub-button--secondary" type="button" disabled={busy} onClick={() => setMode("return")} data-testid="return-button">
          {screen.actions.returnToAuthor}
        </button>
        <button className="hub-button hub-button--secondary" type="button" disabled={busy} onClick={() => setMode("discard")} data-testid="discard-button">
          {screen.actions.discard}
        </button>
      </Inline>
    ) : mode === "return" ? (
      <Inline gap="target" wrap>
        <button className="hub-button hub-button--primary" type="submit" form={RETURN_FORM} disabled={busy || over} data-testid="send-back-button">
          {screen.returnForm.send}
        </button>
        <button className="hub-button hub-button--secondary" type="button" disabled={busy} onClick={() => setMode(null)} data-testid="cancel-button">
          {screen.returnForm.cancel}
        </button>
      </Inline>
    ) : (
      <Inline gap="target" wrap>
        <button className="hub-button hub-button--primary" type="submit" form={DISCARD_FORM} disabled={busy} data-testid="discard-confirm-button">
          {screen.discardForm.confirm}
        </button>
        <button className="hub-button hub-button--secondary" type="button" disabled={busy} onClick={() => setMode(null)} data-testid="cancel-button">
          {screen.discardForm.cancel}
        </button>
      </Inline>
    );

  const facts = screen.facts;
  const main = (
    <Stack gap="section-hub-review">
      {/* Above the fold on a phone: what it is, the English text, what goes out and which languages fell back; the rest follows. */}
      <Stack gap="related">
        <h1>{screen.title}</h1>
        <p data-testid="entry-header">
          <strong>{screen.header.types}</strong>
          {screen.header.submitted ? ` · ${screen.header.submitted}` : ""}
        </p>
        {screen.header.drill && (
          <p role="note" className="hub-flag" data-testid="drill-note">
            {screen.header.drill}
          </p>
        )}
        {screen.header.by && (
          <p role="note" className="hub-flag" data-testid="ambassador-note">
            {screen.header.by}
          </p>
        )}
        {screen.header.update && (
          <p role="note" className="hub-flag hub-wrap" data-testid="update-note">
            {screen.header.update}
          </p>
        )}
      </Stack>
      {screen.locked && (
        <section data-testid="locked">
          <Stack gap="related">
            <p role="note" className="hub-flag" data-testid="locked-note">
              {screen.locked.message}
            </p>
            {screen.locked.note && <p className="hub-wrap hub-preline">{screen.locked.note}</p>}
          </Stack>
        </section>
      )}
      <Problem id="approval-error" message={problem} />
      {changed && (
        <section aria-labelledby="count-title" aria-live="polite" data-testid="count-changed">
          <Stack gap="related">
            <h2 id="count-title" role="alert" className="hub-error">
              {changed.message}
            </h2>
            <p>
              <strong>{changed.nowTitle}</strong>
            </p>
            <Stack as="ul" gap="subline">
              {changed.rows.map((row) => (
                <li key={row.lang} data-testid={`count-${row.lang}`}>
                  {row.english}: {row.n}
                </li>
              ))}
            </Stack>
            <p data-testid="count-cost">{changed.cost}</p>
            <label className="hub-choice">
              <input type="checkbox" name="confirm-count" form={APPROVE_FORM} required checked={confirmed} onChange={(event) => setConfirmedFor(event.target.checked ? approveState : null)} data-testid="confirm-count" />
              <span>{changed.confirm}</span>
            </label>
          </Stack>
        </section>
      )}
      {mode === "return" && screen.status === "review" && (
        <form id={RETURN_FORM} action={returnAction} data-testid="return-form">
          <Bound screen={screen} />
          <Stack gap="related">
            <h2>{screen.returnForm.title}</h2>
            <p>{screen.returnForm.hint}</p>
            <label htmlFor="return-note">
              <strong>{screen.returnForm.noteLabel}</strong>
            </label>
            <textarea
              id="return-note"
              className="hub-input"
              name="note"
              rows={5}
              required
              value={note}
              aria-invalid={over || undefined}
              aria-describedby="return-note-count"
              data-testid="return-note"
              onChange={(event) => setNote(event.target.value)}
            />
            <p id="return-note-count" className={over ? "hub-error" : undefined} data-testid="return-note-count">
              {fill(screen.returnForm.counter, { n: [...note].length })}
            </p>
          </Stack>
        </form>
      )}
      {mode === "discard" && screen.status === "review" && (
        <form id={DISCARD_FORM} action={discardAction} data-testid="discard-form">
          <Bound screen={screen} />
          <Stack gap="related">
            <h2>{screen.discardForm.title}</h2>
            <p>{screen.discardForm.lead}</p>
          </Stack>
        </form>
      )}
      {screen.status === "review" && (
        <form id={APPROVE_FORM} action={approveAction} data-testid="approve-form">
          <Bound screen={screen} reviewed={changed ? changed.reviewed : screen.binding.reviewed} />
        </form>
      )}
      <section aria-labelledby="english-title" data-testid="english-text">
        <Stack gap="related">
          <h2 id="english-title">{screen.english.title}</h2>
          <p className="hub-wrap hub-prewrap" lang="en" data-testid="english-body">
            {screen.english.body}
          </p>
        </Stack>
      </section>
      <section aria-label={facts.title} data-testid="facts">
        <Stack gap="related">
          <p className="hub-wrap" data-testid="fact-audience">
            <strong>{facts.audience.label}</strong> <span data-testid="audience-sentence">{facts.audience.sentence}</span>{" "}
            <span data-testid="audience-groups">{facts.audience.groups}</span>
          </p>
          {/* An update that changes who it is for says so right under who it is for: what it newly reaches, and what it no longer reaches (S05.01). */}
          {facts.audience.change && (
            <Stack gap="subline" testId="audience-change">
              {facts.audience.change.alsoFor && (
                <p role="note" className="hub-flag hub-wrap" data-testid="audience-also-for">
                  {facts.audience.change.alsoFor}
                </p>
              )}
              {facts.audience.change.noLongerFor && (
                <p role="note" className="hub-flag hub-wrap" data-testid="audience-no-longer-for">
                  {facts.audience.change.noLongerFor}
                </p>
              )}
            </Stack>
          )}
          <p className="hub-wrap" data-testid="fact-channels">
            <strong>{facts.channels.label}</strong> {facts.channels.items.join(" ")}
          </p>
          <p className="hub-wrap" data-testid="fact-recipients">
            <strong>{facts.recipients.label}</strong> <span data-testid="recipient-count">{facts.recipients.count}</span>
            {facts.recipients.notOpen && (
              <>
                {" · "}
                <span data-testid="sms-not-open">{facts.recipients.notOpen}</span>
              </>
            )}
          </p>
          <p className="hub-wrap" data-testid="fact-cost">
            <strong>{facts.cost.label}</strong> <span data-testid="estimated-cost">{facts.cost.value}</span>
          </p>
          <p className="hub-wrap" data-testid="fact-valid-until">
            <strong>{facts.validUntil.label}</strong> {facts.validUntil.value}
          </p>
        </Stack>
      </section>
      {screen.fallback && (
        <section data-testid="fallback">
          <Stack gap="related">
            <p role="note" className="hub-flag" data-testid="fallback-summary">
              {screen.fallback.summary}
            </p>
            {screen.fallback.recipients && <p className="hub-wrap">{screen.fallback.recipients}</p>}
          </Stack>
        </section>
      )}
      {/* Below the fold: the rest of what the approver should know, and why they cannot change anything here. */}
      <Stack gap="related">
        {screen.status === "review" && <p className="hub-wrap">{screen.lead}</p>}
        {facts.recipients.byLanguage && (
          <p className="hub-wrap" data-testid="recipients-by-language">
            {facts.recipients.byLanguage.label} {facts.recipients.byLanguage.items.join(", ")}
          </p>
        )}
        <p className="hub-wrap">{facts.cost.note}</p>
        {facts.audience.floorNote && <p className="hub-wrap">{facts.audience.floorNote}</p>}
        {screen.allTranslated && <p data-testid="all-translated">{screen.allTranslated}</p>}
        {screen.duplicate && (
          <section data-testid="duplicate">
            <Stack gap="related">
              <p role="note" className="hub-flag" data-testid="duplicate-note">
                {screen.duplicate.text}
              </p>
              {screen.duplicate.link && (
                <a className="tap hub-link" href={screen.duplicate.link.href} data-testid="duplicate-link">
                  {screen.duplicate.link.label}
                </a>
              )}
            </Stack>
          </section>
        )}
        {screen.status === "review" && <p className="hub-wrap">{screen.cannotEdit}</p>}
      </Stack>
    </Stack>
  );

  const aside = (
    <aside aria-labelledby="languages-title" data-testid="approval-aside">
      <Stack gap="related">
        <h2 id="languages-title">{screen.languages.title}</h2>
        <p>{screen.languages.lead}</p>
        <Stack as="ul" gap="related">
          {screen.languages.rows.map((row) => (
            <LanguageItem key={row.lang} row={row} webLabel={screen.languages.webLabel} />
          ))}
        </Stack>
      </Stack>
    </aside>
  );

  const columns = (
    <Grid twoColumn="aside">
      {main}
      {aside}
    </Grid>
  );
  return bar ? (
    <Screen surface="staff" width="review" actions={bar} actionsLabel={screen.actions.label}>
      {columns}
    </Screen>
  ) : (
    <Screen surface="staff" width="review">
      {columns}
    </Screen>
  );
}
