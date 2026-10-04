"use client";

// What an ambassador may do about their post and its alert (S08.04, A-03): correct their own post, withdraw it, "Mark resolved". Every text comes from the view model
// (view.ts); this holds what the person typed and hands one press at a time to the sender (../post/postSender.ts), which keeps the request in this page's memory until
// it is delivered, with the same unsent-post rule as a post: nothing is written to the phone's storage. Each request goes to the Hub for a second person's approval;
// nothing is replaced or closed until then.
import { useEffect, useRef, useState } from "react";
import { AMBASSADOR_FOLLOW_ROUTE, type AmbassadorFollowRequest } from "@/contracts/ambassadorFollow";
import { Inline, Stack } from "@/ui";
import { createPostSender, type PostSender, type SendState } from "../post/postSender";
import type { FollowScreen } from "./view";

export type FollowAction = AmbassadorFollowRequest["action"];
export type FollowProblem = "text" | "tooLong" | "reason" | "words" | "valid" | "phase";

/** Where the forms start: what is typed, the problems shown and where the request stands (the layout tests and screenshots draw each state). */
export interface FollowInitial {
  open?: FollowAction;
  text?: string;
  reason?: string;
  problems?: readonly FollowProblem[];
  state?: SendState;
  action?: FollowAction;
}

type FollowSender = PostSender<AmbassadorFollowRequest>;
/** A request without its key (the sender adds it), whichever of the three it is. */
type FollowBody = AmbassadorFollowRequest extends infer U ? (U extends unknown ? Omit<U, "key"> : never) : never;

/** The browser's seams for the sender: the network, the `online` event and a timer; never any storage. */
function browserSender(onChange: (state: SendState) => void): FollowSender {
  return createPostSender<AmbassadorFollowRequest>(
    {
      fetch: (url, init) => fetch(url, { ...init, credentials: "same-origin", cache: "no-store" }),
      isOnline: () => navigator.onLine,
      onOnline: (listener) => {
        window.addEventListener("online", listener);
        return () => window.removeEventListener("online", listener);
      },
      later: (run, ms) => {
        const timer = window.setTimeout(run, ms);
        return () => window.clearTimeout(timer);
      },
      newKey: () => crypto.randomUUID(),
      url: AMBASSADOR_FOLLOW_ROUTE,
    },
    onChange,
  );
}

export function FollowForms({ screen, sender: givenSender, initial = {} }: { screen: FollowScreen; sender?: (onChange: (state: SendState) => void) => FollowSender; initial?: FollowInitial }) {
  const { words } = screen;
  const [state, setState] = useState<SendState>(initial.state ?? { kind: "idle" });
  const [pressed, setPressed] = useState<FollowAction | null>(initial.action ?? null);
  const senderRef = useRef<FollowSender | null>(null);
  useEffect(() => {
    const sender = (givenSender ?? browserSender)(setState);
    senderRef.current = sender;
    return () => sender.stop();
  }, [givenSender]);

  const [open, setOpen] = useState<FollowAction | null>(initial.open ?? null);
  const [problems, setProblems] = useState<ReadonlySet<FollowProblem>>(new Set(initial.problems ?? []));
  /** The form the problems belong to: the others show none. */
  const [problemsOf, setProblemsOf] = useState<FollowAction | null>(initial.problems && initial.problems.length > 0 ? (initial.open ?? null) : null);
  const [correctText, setCorrectText] = useState(initial.text ?? screen.correct?.text ?? "");
  const [phase, setPhase] = useState<"problem" | "in_progress">(screen.correct?.phase ?? "problem");
  const [validMode, setValidMode] = useState<"resolved" | "at">("resolved");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState(initial.reason ?? "");
  const [withdrawWords, setWithdrawWords] = useState("");
  const [resolveText, setResolveText] = useState(initial.text ?? "");

  const busy = state.kind === "sending" || state.kind === "unsent" || state.kind === "working";

  // A request that has not reached the Hub is lost with the page: the browser asks before the page closes.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const max = words.text.max;
  const errorOf = (action: FollowAction, problem: FollowProblem, message: string, id: string) =>
    problemsOf === action && problems.has(problem) ? (
      <p id={id} role="alert" className="hub-error">
        {message}
      </p>
    ) : null;

  function send(action: FollowAction, found: Set<FollowProblem>, body: FollowBody | null) {
    setProblems(found);
    setProblemsOf(action);
    if (found.size > 0 || body === null) return;
    setPressed(action);
    senderRef.current?.press(body);
  }

  function pressCorrect() {
    if (!screen.correct || !screen.postId) return;
    const found = new Set<FollowProblem>();
    if (correctText.trim() === "") found.add("text");
    else if (correctText.trim().length > max) found.add("tooLong");
    if (validMode === "at" && (date === "" || time === "")) found.add("valid");
    send("correct", found, {
      v: 1,
      action: "correct",
      alert_id: screen.alertId,
      entry_id: screen.correct.entryId,
      target: screen.postId,
      phase,
      valid: validMode === "resolved" ? { mode: "resolved" } : { mode: "at", date, time },
      text: correctText,
    });
  }

  function pressWithdraw() {
    if (!screen.withdraw || !screen.postId) return;
    const found = new Set<FollowProblem>();
    if (reason === "") found.add("reason");
    if (reason === "other" && withdrawWords.trim() === "") found.add("words");
    if (withdrawWords.trim().length > max) found.add("tooLong");
    send("withdraw", found, { v: 1, action: "withdraw", alert_id: screen.alertId, entry_id: screen.withdraw.entryId, target: screen.postId, reason, text: withdrawWords });
  }

  function pressResolve() {
    if (!screen.resolve) return;
    const found = new Set<FollowProblem>();
    if (resolveText.trim() === "") found.add("text");
    else if (resolveText.trim().length > max) found.add("tooLong");
    send("resolve", found, { v: 1, action: "resolve", alert_id: screen.alertId, entry_id: screen.resolve.entryId, text: resolveText });
  }

  if (state.kind === "done") {
    return (
      <section aria-labelledby="follow-sent-title" data-testid="follow-done">
        <Stack gap="related">
          <h2 id="follow-sent-title" tabIndex={-1} className="hub-wrap">
            {words.sent.title}
          </h2>
          <p role="status" className="hub-wrap">
            {words.sent.line}
          </p>
          {state.live === true && pressed === "correct" && <p className="hub-wrap">{words.sent.live}</p>}
          {pressed === "resolve" && <p className="hub-wrap">{words.sent.resolve}</p>}
          <a className="tap hub-link" href={screen.back.href}>
            {screen.back.label}
          </a>
        </Stack>
      </section>
    );
  }

  const errorMessage = state.kind === "error" ? (state.code === "signed_out" ? words.errors.signedOut : state.code === "not_assigned" ? words.errors.notAssigned : (words.errors[state.code] ?? words.errors.fallback)) : null;
  const toggle = (action: FollowAction) => (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open) setOpen(action);
    else setOpen((current) => (current === action ? null : current));
  };
  const status = (
    <>
      {state.kind === "unsent" && (
        <Stack gap="subline" testId="follow-unsent">
          <p role="status" className="hub-flag">
            {words.status.unsent}
          </p>
          <p>{words.status.unsentClose}</p>
        </Stack>
      )}
      {(state.kind === "sending" || state.kind === "working") && <p role="status">{words.status.sending}</p>}
      {errorMessage && (
        <p role="alert" className="hub-error" data-testid="follow-error">
          {errorMessage}
        </p>
      )}
    </>
  );

  return (
    <Stack gap="section-hub-main" testId="follow">
      {screen.correct && (
        <details open={open === "correct"} onToggle={toggle("correct")} data-testid="follow-correct">
          <summary className="tap hub-summary">{words.correct.open}</summary>
          <Stack gap="related">
            <p className="hub-wrap">{words.correct.lead}</p>
            <Stack gap="target">
              <label htmlFor="follow-correct-text">
                {words.correct.label} <span className="hub-flag__label">{words.required}</span>
              </label>
              {errorOf("correct", "text", words.textErrors.empty, "follow-correct-error")}
              {errorOf("correct", "tooLong", words.textErrors.tooLong, "follow-correct-error")}
              <textarea id="follow-correct-text" className="hub-input" rows={4} value={correctText} disabled={busy} aria-describedby="follow-correct-hint" onChange={(event) => setCorrectText(event.target.value)} />
              <p id="follow-correct-hint">{words.text.hint}</p>
            </Stack>
            <fieldset aria-labelledby="follow-phase">
              <Stack gap="target">
                <legend id="follow-phase">
                  {words.phase.legend} <span className="hub-flag__label">{words.required}</span>
                </legend>
                <label className="hub-choice">
                  <input type="radio" name="follow-phase" value="problem" checked={phase === "problem"} disabled={busy} onChange={() => setPhase("problem")} />
                  <span>{words.phase.problem}</span>
                </label>
                <label className="hub-choice">
                  <input type="radio" name="follow-phase" value="in_progress" checked={phase === "in_progress"} disabled={busy} onChange={() => setPhase("in_progress")} />
                  <span>{words.phase.progress}</span>
                </label>
              </Stack>
            </fieldset>
            <fieldset aria-labelledby="follow-valid">
              <Stack gap="target">
                <legend id="follow-valid">{words.valid.legend}</legend>
                {errorOf("correct", "valid", words.textErrors.valid, "follow-valid-error")}
                <label className="hub-choice">
                  <input type="radio" name="follow-valid-mode" value="resolved" checked={validMode === "resolved"} disabled={busy} onChange={() => setValidMode("resolved")} />
                  <span>{words.valid.resolved}</span>
                </label>
                <label className="hub-choice">
                  <input type="radio" name="follow-valid-mode" value="at" checked={validMode === "at"} disabled={busy} onChange={() => setValidMode("at")} />
                  <span>{words.valid.at}</span>
                </label>
                {validMode === "at" && (
                  <Inline gap="related" align="center" wrap>
                    <label htmlFor="follow-date">{words.valid.date}</label>
                    <input id="follow-date" className="hub-input" type="date" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} />
                    <label htmlFor="follow-time">{words.valid.time}</label>
                    <input id="follow-time" className="hub-input" type="time" value={time} disabled={busy} onChange={(event) => setTime(event.target.value)} />
                  </Inline>
                )}
                <p>{words.valid.hint}</p>
              </Stack>
            </fieldset>
            {open === "correct" && status}
            <Inline gap="target">
              <button className="hub-button hub-button--primary" type="button" disabled={busy} onClick={pressCorrect}>
                {words.correct.button}
              </button>
            </Inline>
          </Stack>
        </details>
      )}

      {screen.withdraw && (
        <details open={open === "withdraw"} onToggle={toggle("withdraw")} data-testid="follow-withdraw">
          <summary className="tap hub-summary">{words.withdraw.open}</summary>
          <Stack gap="related">
            <p className="hub-wrap">{words.withdraw.lead}</p>
            <fieldset aria-labelledby="follow-reason">
              <Stack gap="target">
                <legend id="follow-reason">
                  {words.withdraw.reason} <span className="hub-flag__label">{words.required}</span>
                </legend>
                {errorOf("withdraw", "reason", words.withdraw.reasonError, "follow-reason-error")}
                {words.withdraw.reasons.map((item) => (
                  <label key={item.id} className="hub-choice">
                    <input type="radio" name="follow-reason" value={item.id} checked={reason === item.id} disabled={busy} onChange={() => setReason(item.id)} />
                    <span>{item.label}</span>
                  </label>
                ))}
              </Stack>
            </fieldset>
            <Stack gap="target">
              <label htmlFor="follow-withdraw-words">{words.withdraw.words}</label>
              {errorOf("withdraw", "words", words.textErrors.empty, "follow-words-error")}
              {errorOf("withdraw", "tooLong", words.textErrors.tooLong, "follow-words-error")}
              <textarea id="follow-withdraw-words" className="hub-input" rows={3} value={withdrawWords} disabled={busy} onChange={(event) => setWithdrawWords(event.target.value)} />
            </Stack>
            {open === "withdraw" && status}
            <Inline gap="target">
              <button className="hub-button hub-button--primary" type="button" disabled={busy} onClick={pressWithdraw}>
                {words.withdraw.button}
              </button>
            </Inline>
          </Stack>
        </details>
      )}

      {screen.resolve && (
        <details open={open === "resolve" || screen.postId === null} onToggle={toggle("resolve")} data-testid="follow-resolve">
          <summary className="tap hub-summary">{words.resolve.open}</summary>
          <Stack gap="related">
            <p className="hub-wrap">{words.resolve.lead}</p>
            <Stack gap="target">
              <label htmlFor="follow-resolve-text">
                {words.resolve.label} <span className="hub-flag__label">{words.required}</span>
              </label>
              {errorOf("resolve", "text", words.textErrors.empty, "follow-resolve-error")}
              {errorOf("resolve", "tooLong", words.textErrors.tooLong, "follow-resolve-error")}
              <textarea id="follow-resolve-text" className="hub-input" rows={4} value={resolveText} disabled={busy} aria-describedby="follow-resolve-hint" onChange={(event) => setResolveText(event.target.value)} />
              <p id="follow-resolve-hint">{words.text.hint}</p>
            </Stack>
            {(open === "resolve" || screen.postId === null) && status}
            <Inline gap="target">
              <button className="hub-button hub-button--primary" type="button" disabled={busy} onClick={pressResolve}>
                {words.resolve.button}
              </button>
            </Inline>
          </Stack>
        </details>
      )}
    </Stack>
  );
}
