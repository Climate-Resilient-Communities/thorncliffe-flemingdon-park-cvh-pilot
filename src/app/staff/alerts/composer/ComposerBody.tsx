"use client";

import { useActionState, useEffect, useReducer, useRef, useState } from "react";
import { Grid, Inline, Screen, Stack } from "@/ui";
import type { ComposeState } from "./editDraft";
import { doneCount, initialSubmitUi, submitReducer, unconfirmedOf, type SubmitKind } from "./submitMachine";
import { submitApi, type SubmitApi } from "./submitClient";
import { press } from "./submitPress";
import { readUnconfirmed, reconcile, writeUnconfirmed } from "./submitStore";
import type { ComposerScreen, DraftFormView, LanguageRowView, PendingView } from "./view";

/** A composer form's server action (actions.ts): the form's last state and its data in, the new state out. */
export type ComposeAction = (previous: ComposeState, form: FormData) => Promise<ComposeState>;

export interface ComposerActions {
  save: ComposeAction;
  pullBack: ComposeAction;
}

const IDLE: ComposeState = { status: "idle" };
const FORM_ID = "composer-form";
const PULL_BACK_ID = "pull-back-form";

const defaultApi = submitApi();

/** Test seam: forms already in the state they reach after a refusal (the screenshots show them). */
export interface ComposerInitial {
  save?: ComposeState;
}

function Problem({ id, message }: { id: string; message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="hub-error">
      {message}
    </p>
  );
}

/** Replaces `{name}` in a string the server left as a template. */
const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));

function LanguageList({ rows, progress, waiting, results }: { rows: LanguageRowView[]; progress: Readonly<Record<string, string>> | null; waiting: string; results: Record<string, string> }) {
  return (
    <Stack as="ul" gap="related">
      {rows.map((row) => {
        // While a submit runs, each language shows as it settles; otherwise what the server stores (or "translated when you submit").
        const settled = progress === null ? undefined : progress[row.lang];
        const label = progress === null ? row.stateLabel : settled ? (results[settled] ?? settled) : waiting;
        return (
          <li key={row.lang} className="hub-list-item" data-testid={`language-${row.lang}`} data-state={progress === null ? row.state : (settled ?? "waiting")}>
            <Inline gap="related" align="baseline" wrap>
              <strong className="hub-wrap" lang={row.bcp47} dir={row.dir}>
                {row.native}
              </strong>
              <span className="hub-wrap">{row.english}</span>
              <span className="hub-wrap">{label}</span>
            </Inline>
          </li>
        );
      })}
    </Stack>
  );
}

/** The fields of a draft: the text, the valid-until and, for the full alert, the types and where things stand. Controlled, so a refusal leaves what was typed. */
function DraftFields({ form, state, errorId }: { form: DraftFormView; state: ComposeState; errorId: string }) {
  const [text, setText] = useState(form.text.value);
  const [validMode, setValidMode] = useState<"resolved" | "at">(form.valid.mode);
  const [date, setDate] = useState(form.valid.fields.date);
  const [time, setTime] = useState(form.valid.fields.time);
  // The answer to "before or after the clock change" for a stored time in the repeated hour travels with the form until the time is edited.
  const [fold, setFold] = useState<"" | "before" | "after">(form.valid.fields.fold);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set([...(form.types?.building ?? []), ...(form.types?.neighbourhood ?? [])].filter((item) => item.checked).map((item) => item.id)));
  const [phase, setPhase] = useState(form.phase?.items.find((item) => item.checked)?.id ?? "");
  const over = text.length > form.text.max;
  const describedBy = state.status === "refused" ? errorId : undefined;
  const toggle = (id: string, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <Stack gap="stack">
      {form.types ? (
        <fieldset aria-labelledby="composer-types-legend" aria-describedby={describedBy}>
          <Stack gap="target">
            <legend id="composer-types-legend">{form.types.legend}</legend>
            <input type="hidden" name="types-sent" value="1" />
            <Inline gap="target" wrap>
              {[...form.types.building, ...form.types.neighbourhood].map((item) => (
                <label key={item.id} className="hub-choice">
                  <input type="checkbox" name="type" value={item.id} checked={ticked.has(item.id)} onChange={(event) => toggle(item.id, event.target.checked)} />
                  <span>{item.label}</span>
                </label>
              ))}
            </Inline>
          </Stack>
        </fieldset>
      ) : (
        <p data-testid="types-summary">
          <strong>{form.typesSummary}</strong>
        </p>
      )}
      {form.phase && (
        <fieldset aria-labelledby="composer-phase-legend">
          <Stack gap="target">
            <legend id="composer-phase-legend">{form.phase.legend}</legend>
            {form.phase.items.map((item) => (
              <label key={item.id} className="hub-choice">
                <input type="radio" name="phase" value={item.id} checked={phase === item.id} onChange={() => setPhase(item.id)} />
                <span>{item.label}</span>
              </label>
            ))}
          </Stack>
        </fieldset>
      )}
      <Stack gap="related">
        <label htmlFor="composer-text">
          <strong>{form.text.label}</strong>
        </label>
        <p id="composer-text-hint">{form.text.hint}</p>
        <textarea
          id="composer-text"
          className="hub-input"
          name="text"
          rows={6}
          value={text}
          required
          aria-describedby={`composer-text-hint composer-text-count${describedBy ? ` ${describedBy}` : ""}`}
          aria-invalid={over || undefined}
          data-testid="composer-text"
          onChange={(event) => setText(event.target.value)}
        />
        <p id="composer-text-count" className={over ? "hub-error" : undefined} data-testid="composer-count">
          {fill(form.text.counter, { n: text.length })}
        </p>
      </Stack>
      <fieldset aria-labelledby="composer-valid-legend" aria-describedby={describedBy}>
        <Stack gap="target">
          <legend id="composer-valid-legend">{form.valid.title}</legend>
          <label className="hub-choice">
            <input type="radio" name="valid-mode" value="resolved" checked={validMode === "resolved"} onChange={() => setValidMode("resolved")} />
            <span>{form.valid.resolvedLabel}</span>
          </label>
          <label className="hub-choice">
            <input type="radio" name="valid-mode" value="at" checked={validMode === "at"} onChange={() => setValidMode("at")} />
            <span>{form.valid.atLabel}</span>
          </label>
          <Inline gap="related" align="center" wrap>
            <label htmlFor="valid-date">{form.valid.dateLabel}</label>
            <input
              id="valid-date"
              className="hub-input"
              type="date"
              name="valid-date"
              value={date}
              disabled={validMode !== "at"}
              onChange={(event) => {
                setDate(event.target.value);
                setFold("");
              }}
            />
            <label htmlFor="valid-time">{form.valid.timeLabel}</label>
            <input
              id="valid-time"
              className="hub-input"
              type="time"
              name="valid-time"
              value={time}
              disabled={validMode !== "at"}
              onChange={(event) => {
                setTime(event.target.value);
                setFold("");
              }}
            />
          </Inline>
          {state.status !== "ask" && fold !== "" && <input type="hidden" name="valid-fold" value={fold} />}
          <p>{form.valid.hint}</p>
          {state.status === "ask" && (
            <fieldset aria-labelledby="composer-fold-legend">
              <Stack gap="target">
                <legend id="composer-fold-legend">{form.valid.foldLegend}</legend>
                <p role="alert" className="hub-error" data-testid="fold-question">
                  {state.question}
                </p>
                <label className="hub-choice">
                  <input type="radio" name="valid-fold" value="before" checked={fold === "before"} required onChange={() => setFold("before")} />
                  <span>{state.before}</span>
                </label>
                <label className="hub-choice">
                  <input type="radio" name="valid-fold" value="after" checked={fold === "after"} onChange={() => setFold("after")} />
                  <span>{state.after}</span>
                </label>
              </Stack>
            </fieldset>
          )}
        </Stack>
      </fieldset>
    </Stack>
  );
}

function PendingPanel({ pending }: { pending: PendingView }) {
  return (
    <section aria-labelledby="pending-title" data-testid="pending-panel">
      <Stack gap="related">
        <h2 id="pending-title">{pending.title}</h2>
        <p>{pending.lead}</p>
        {pending.fallback && (
          <p role="note" className="hub-flag" data-testid="fallback-summary">
            {pending.fallback.summary}
          </p>
        )}
        {pending.allTranslated && <p data-testid="all-translated">{pending.allTranslated}</p>}
        {pending.fallback && <p>{pending.fallback.retryNote}</p>}
        <p>{pending.pullBack.note}</p>
        {pending.duplicate && (
          <p role="note" className="hub-flag" data-testid="duplicate-note">
            {pending.duplicate}
          </p>
        )}
      </Stack>
    </section>
  );
}

/**
 * The composers (O-12 the acknowledgement, O-02 the full alert, S04.05). One screen with three states: a draft being written (the
 * form, Save draft, Submit for approval), a submitted entry waiting for a second person (what was frozen, language by language, with
 * "Try translation again" when a language fell back, and "Pull back to edit"), and an entry that can no longer be changed here.
 *
 * Below 800 px of content width it is one column, the main content first and the aside after it, and from 800 px two columns
 * (the Hub's two-column Grid). The actions stay in the sticky actions region in both layouts.
 *
 * A press of Submit saves the draft, makes a key for this press, sends it, and shows progress per language while the translation runs
 * outside any lock. If the answer is not seen, the screen fetches the entry's state and goes by that (submitMachine.ts), and a page
 * opened while an attempt runs shows its progress.
 */
export function ComposerBody({
  screen,
  actions,
  initial,
  api = defaultApi,
  reload = () => window.location.assign(screen.here),
}: {
  screen: ComposerScreen;
  actions: ComposerActions;
  initial?: ComposerInitial;
  api?: SubmitApi;
  /** Loads the composer again from the server (the attempt ended). */
  reload?: () => void;
}) {
  const [saveState, saveAction, savePending] = useActionState(actions.save, initial?.save ?? IDLE);
  // What the direct call of Save (the first half of a submit) answered, when it did not save.
  const [direct, setDirect] = useState<ComposeState>(IDLE);
  const [pullState, pullAction] = useActionState(actions.pullBack, IDLE);
  // Where the screen starts: an attempt that is still running, and a key kept in this tab whose outcome the server never confirmed (unless the
  // server's own state, which this page was made from, already shows it).
  const [ui, dispatch] = useReducer(submitReducer, null, () => initialSubmitUi(screen.resume, reconcile(readUnconfirmed(screen.ref.entryId), screen.lastAttemptKey)));
  const formRef = useRef<HTMLFormElement>(null);
  const { alertId, entryId } = screen.ref;
  const shown = direct.status !== "idle" ? direct : saveState;
  const errorId = "composer-error";
  const running = ui.phase === "running" ? ui : null;
  const busy = ui.phase === "saving" || ui.phase === "running";

  // A key whose outcome is not known is kept in this tab (and forgotten once it is), so a page that is loaded again still sends the same key.
  const pending = unconfirmedOf(ui);
  const pendingKey = pending?.key ?? null;
  const pendingKind = pending?.kind ?? null;
  useEffect(() => {
    writeUnconfirmed(entryId, pendingKey === null || pendingKind === null ? null : { key: pendingKey, kind: pendingKind });
  }, [entryId, pendingKey, pendingKind]);

  // While an attempt runs, the entry's state is fetched every second: progress for this key, and the end of it, whether or not the
  // answer to the press was seen.
  const pollKey = running?.key ?? null;
  useEffect(() => {
    if (pollKey === null) return;
    let active = true;
    const timer = setInterval(() => {
      api
        .state(alertId, entryId)
        .catch(() => null)
        .then((state) => {
          if (active) dispatch({ type: "polled", state, at: performance.now() });
        });
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pollKey, alertId, entryId, api]);

  // An attempt that ended (froze the entry, or failed) loads the page again: what it shows is what the server stores, including why it failed.
  useEffect(() => {
    if (ui.phase === "ended") reload();
  }, [ui.phase, reload]);

  function pressed(kind: SubmitKind) {
    if (busy) return;
    void press(
      {
        alertId,
        entryId,
        api,
        // The draft is saved first, from what the form holds now, so the submit freezes what the author sees.
        save: () => {
          const form = new FormData(formRef.current ?? undefined);
          form.set("then", "submit");
          return actions.save(IDLE, form);
        },
        saveFailed: { status: "refused", message: screen.messages.errors.invalid },
        showSave: setDirect,
        seen: () => ({ version: screen.pending?.version ?? 1, hash: screen.pending?.contentHash ?? "" }),
        dispatch,
        newKey: () => crypto.randomUUID(),
        now: () => performance.now(),
      },
      unconfirmedOf(ui),
      kind,
    );
  }

  const idleMessage = ui.phase === "idle" && ui.message ? (screen.messages.errors[ui.message] ?? screen.messages.errors.invalid) : null;
  const problem = shown.status === "refused" ? shown.message : idleMessage;
  const progress = running ? running.progress : null;
  const seconds = running?.budgetMs ? Math.ceil(running.budgetMs / 1000) : null;

  const draftActions = (
    <Inline gap="target" wrap>
      <button className="hub-button hub-button--secondary" type="submit" form={FORM_ID} disabled={busy || savePending} data-testid="save-draft">
        {screen.actions.save}
      </button>
      <button className="hub-button hub-button--primary" type="button" disabled={busy || savePending} onClick={() => pressed("submit")} data-testid="submit-button">
        {screen.actions.submit}
      </button>
    </Inline>
  );
  const pendingActions = screen.pending && (
    <Inline gap="target" wrap>
      <button className="hub-button hub-button--secondary" type="submit" form={PULL_BACK_ID} disabled={busy} data-testid="pull-back">
        {screen.pending.pullBack.label}
      </button>
      {screen.pending.fallback && (
        <button className="hub-button hub-button--primary" type="button" disabled={busy} onClick={() => pressed("retranslate")} data-testid="retry-translation">
          {screen.pending.fallback.retry}
        </button>
      )}
    </Inline>
  );
  const bar = screen.status === "draft" ? draftActions : screen.status === "pending" ? pendingActions : undefined;

  const header = (
    <Stack gap="related">
      <h1>{screen.title}</h1>
      <p>{screen.lead}</p>
      <p data-testid="first-report">{screen.firstReport}</p>
      <p>{screen.benchmark}</p>
    </Stack>
  );

  const body = (
    <Stack gap={screen.mode === "ack" ? "section-hub-review" : "section-hub"}>
      {header}
      {screen.notice && saveState.status === "idle" && <p role="status">{screen.notice}</p>}
      {screen.failure && ui.phase === "idle" && <Problem id="composer-failure" message={screen.failure} />}
      <Problem id={errorId} message={problem ?? (pullState.status === "refused" ? pullState.message : null)} />
      {busy && (
        <section aria-labelledby="running-title" aria-live="polite" data-testid="submit-panel">
          <Stack gap="related">
            <h2 id="running-title">{screen.messages.running.title}</h2>
            <p>{seconds === null ? screen.messages.running.leadUnknown : fill(screen.messages.running.lead, { seconds })}</p>
            <p data-testid="progress-summary">{fill(screen.messages.running.summary, { done: progress ? doneCount(progress) : 0, total: screen.languages.rows.length })}</p>
            {running?.lost && (
              <p role="status" data-testid="lost-note">
                {screen.messages.running.lost}
              </p>
            )}
          </Stack>
        </section>
      )}
      {screen.status === "draft" && screen.draft && (
        <form ref={formRef} id={FORM_ID} action={saveAction}>
          <Stack gap="stack">
            <input type="hidden" name="alert" value={alertId} />
            <input type="hidden" name="entry" value={entryId} />
            <DraftFields form={screen.draft} state={shown} errorId={errorId} />
          </Stack>
        </form>
      )}
      {screen.status === "pending" && screen.pending && (
        <>
          <PendingPanel pending={screen.pending} />
          <form id={PULL_BACK_ID} action={pullAction}>
            <input type="hidden" name="alert" value={alertId} />
            <input type="hidden" name="entry" value={entryId} />
          </form>
        </>
      )}
      {screen.status === "locked" && screen.locked && (
        <p role="note" className="hub-flag" data-testid="locked-note">
          {screen.locked}
        </p>
      )}
      {screen.preview && screen.status === "draft" && (
        <section aria-labelledby="preview-title" data-testid="sms-preview">
          <Stack gap="related">
            <h2 id="preview-title">{screen.preview.title}</h2>
            <p>{screen.preview.lead}</p>
            <Stack as="ul" gap="subline">
              {screen.preview.lines.map((line, index) => (
                <li key={`${index}-${line}`} className="hub-list-item">
                  {line}
                </li>
              ))}
            </Stack>
            <p>{screen.preview.note}</p>
          </Stack>
        </section>
      )}
      <section aria-labelledby="languages-title" data-testid="languages">
        <Stack gap="related">
          <h2 id="languages-title">{screen.languages.title}</h2>
          <p>{screen.languages.lead}</p>
          <LanguageList rows={screen.languages.rows} progress={progress} waiting={screen.messages.running.waiting} results={screen.messages.result} />
        </Stack>
      </section>
    </Stack>
  );

  const aside = (
    <aside aria-labelledby="composer-aside-title" data-testid="composer-aside">
      <Stack gap="stack">
        <h2 id="composer-aside-title">{screen.aside.title}</h2>
        <p data-testid="audience-sentence">{screen.aside.sentence}</p>
        {screen.aside.floorNote && <p>{screen.aside.floorNote}</p>}
        <p data-testid="audience-groups">{screen.aside.groups}</p>
        {screen.status === "draft" && (
          <>
            <a className="tap hub-link" href={screen.aside.link.href}>
              {screen.aside.link.label}
            </a>
            <a className="tap hub-link" href={screen.aside.groupsLink.href}>
              {screen.aside.groupsLink.label}
            </a>
          </>
        )}
        <h3>{screen.aside.channelsTitle}</h3>
        <Stack as="ul" gap="related">
          {screen.aside.channels.map((channel) => (
            <li key={channel}>{channel}</li>
          ))}
        </Stack>
      </Stack>
    </aside>
  );

  const width = screen.mode === "ack" ? "default" : "review";
  const columns = (
    <Grid twoColumn="aside">
      {body}
      {aside}
    </Grid>
  );
  return bar ? (
    <Screen surface="staff" width={width} actions={bar} actionsLabel={screen.actions.label}>
      {columns}
    </Screen>
  ) : (
    <Screen surface="staff" width={width}>
      {columns}
    </Screen>
  );
}
