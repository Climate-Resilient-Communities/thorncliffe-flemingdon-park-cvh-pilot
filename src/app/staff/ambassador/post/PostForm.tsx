"use client";

// "Post a building update" (A-02, S08.02) as it is drawn and pressed: one column for a phone. Every text comes from the view model (view.ts); this holds what
// the person chose and hands one press at a time to the sender (postSender.ts), which keeps the post in this page's memory until it is delivered. Nothing is
// written to the phone's storage.
import { useEffect, useMemo, useRef, useState } from "react";
import { AMBASSADOR_POST_ROUTE } from "@/contracts/ambassadorPost";
import { Not911 } from "@/ui/emergency";
import { Inline, Stack } from "@/ui";
import { createPostSender, type PostBody, type PostSender, type SendState } from "./postSender";
import { fill, type PostScreen } from "./view";

type FloorsMode = "all" | "list" | "range";
export type PostProblem = "types" | "floors" | "range" | "phase" | "text" | "line" | "tooLong" | "valid";
type Problem = PostProblem;

/** Where the form starts: what the person has chosen already, the problems shown and where the post stands (the layout tests and screenshots draw each state). */
export interface PostInitial {
  types?: readonly string[];
  floorsMode?: FloorsMode;
  phase?: "problem" | "in_progress";
  text?: string;
  problems?: readonly PostProblem[];
  state?: SendState;
}

/** The browser's seams for the sender: the network, the `online` event and a timer; never any storage. */
function browserSender(onChange: (state: SendState) => void): PostSender {
  return createPostSender(
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
      url: AMBASSADOR_POST_ROUTE,
    },
    onChange,
  );
}

export function PostForm({ screen, sender: givenSender, initial = {} }: { screen: PostScreen; sender?: (onChange: (state: SendState) => void) => PostSender; initial?: PostInitial }) {
  const [state, setState] = useState<SendState>(initial.state ?? { kind: "idle" });
  const senderRef = useRef<PostSender | null>(null);
  useEffect(() => {
    const sender = (givenSender ?? browserSender)(setState);
    senderRef.current = sender;
    return () => sender.stop();
  }, [givenSender]);

  const [rsn, setRsn] = useState(screen.buildings.items[0]?.rsn ?? "");
  const building = screen.buildings.items.find((item) => item.rsn === rsn) ?? screen.buildings.items[0];
  const [floorsMode, setFloorsMode] = useState<FloorsMode>(initial.floorsMode ?? "all");
  const [listed, setListed] = useState<ReadonlySet<string>>(new Set());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [types, setTypes] = useState<ReadonlySet<string>>(new Set(initial.types ?? []));
  const [phase, setPhase] = useState<"" | "problem" | "in_progress">(initial.phase ?? "");
  const [validMode, setValidMode] = useState<"resolved" | "at">("resolved");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [text, setText] = useState(initial.text ?? "");
  const [problems, setProblems] = useState<ReadonlySet<Problem>>(new Set(initial.problems ?? []));

  const isOther = screen.types === null ? screen.fixedTypes.includes("other") : types.has("other");
  const busy = state.kind === "sending" || state.kind === "unsent" || state.kind === "working";

  // A post that has not reached the Hub is lost with the page: the browser asks before the page closes.
  useEffect(() => {
    if (state.kind !== "unsent" && state.kind !== "sending" && state.kind !== "working") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.kind]);

  const floorIndex = useMemo(() => new Map(building?.floors.map((floor, index) => [floor.id, index]) ?? []), [building]);
  const labelOf = (id: string) => building?.floors.find((floor) => floor.id === id)?.label ?? "";
  const chosenFloors = (): string => {
    if (floorsMode === "all") return screen.bar.wholeWord;
    if (floorsMode === "list") {
      const ids = [...listed].sort((a, b) => (floorIndex.get(a) ?? 0) - (floorIndex.get(b) ?? 0));
      return ids.length === 1 ? fill(screen.bar.pickOne, { a: labelOf(ids[0]) }).toLowerCase() : screen.bar.someFloors.toLowerCase();
    }
    if (from !== "" && to !== "") return from === to ? fill(screen.bar.pickOne, { a: labelOf(from) }).toLowerCase() : fill(screen.bar.pickRange, { a: labelOf(from), b: labelOf(to) }).toLowerCase();
    return screen.bar.someFloors.toLowerCase();
  };

  /** What is missing or wrong, before anything is sent: each shown beside its field. */
  function check(): Set<Problem> {
    const found = new Set<Problem>();
    if (screen.types !== null && types.size === 0) found.add("types");
    if (floorsMode === "list" && listed.size === 0) found.add("floors");
    if (floorsMode === "range") {
      if (from === "" || to === "") found.add("floors");
      else if ((floorIndex.get(from) ?? 0) > (floorIndex.get(to) ?? 0)) found.add("range");
    }
    if (phase === "") found.add("phase");
    if (text.trim() === "") found.add(isOther ? "line" : "text");
    else if (text.trim().length > screen.text.max) found.add("tooLong");
    if (validMode === "at" && (date === "" || time === "")) found.add("valid");
    return found;
  }

  function press() {
    const found = check();
    setProblems(found);
    if (found.size > 0 || phase === "" || !building) return;
    const body: PostBody = {
      v: 1,
      into: screen.thread?.id ?? null,
      alert_id: screen.ids.alertId,
      entry_id: screen.ids.entryId,
      rsn: building.rsn,
      floors: floorsMode === "all" ? { mode: "all" } : floorsMode === "list" ? { mode: "list", ids: [...listed] } : { mode: "range", from, to },
      types: screen.types === null ? [...screen.fixedTypes] : [...types],
      phase,
      valid: validMode === "resolved" ? { mode: "resolved" } : { mode: "at", date, time },
      text,
    };
    senderRef.current?.press(body);
  }

  const toggle = (set: ReadonlySet<string>, value: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };
  const addPhrase = (phrase: string) => setText((current) => (current.trim() === "" ? phrase : `${current.trim()} ${phrase}`));
  const errorOf = (problem: Problem, message: string, id: string) =>
    problems.has(problem) ? (
      <p id={id} role="alert" className="hub-error">
        {message}
      </p>
    ) : null;

  if (state.kind === "done") {
    return (
      <div className="hub-wrap" data-testid="post-done">
        <Stack gap="related">
          {screen.exercise && (
            <p role="note" className="hub-flag" data-testid="post-exercise">
              {screen.exercise}
            </p>
          )}
          <h1 tabIndex={-1}>{screen.done.title}</h1>
          <p role="status">{screen.done.line}</p>
          <a className="tap hub-link" href={screen.back.href}>
            {screen.done.home}
          </a>
          <a className="tap hub-link" href={screen.done.anotherHref}>
            {screen.done.another}
          </a>
        </Stack>
      </div>
    );
  }

  const errorMessage = state.kind === "error" ? (state.code === "signed_out" ? screen.errors.signedOut : state.code === "not_assigned" ? screen.errors.notAssigned : (screen.errors[state.code] ?? screen.errors.fallback)) : null;
  const options = building?.floors ?? [];

  return (
    <div className="hub-wrap">
      <Stack gap="section-hub-main">
        <Stack gap="related">
          <a className="tap hub-link" href={screen.back.href}>
            {screen.back.label}
          </a>
          {screen.exercise && (
            <p role="note" className="hub-flag" data-testid="post-exercise">
              {screen.exercise}
            </p>
          )}
          <h1>{screen.title}</h1>
          {screen.lead && <p>{screen.lead}</p>}
          {screen.thread && (
            <Stack gap="subline">
              <p className="hub-preline" data-testid="post-thread">
                {screen.thread.line}
              </p>
              <p>{screen.thread.typesLine}</p>
            </Stack>
          )}
        </Stack>

        {screen.buildings.items.length > 1 && (
          <fieldset aria-labelledby="post-building">
            <Stack gap="target">
              <legend id="post-building">{screen.buildings.legend}</legend>
              {screen.buildings.items.map((item) => (
                <label key={item.rsn} className="hub-choice">
                  <input
                    type="radio"
                    name="building"
                    value={item.rsn}
                    checked={item.rsn === rsn}
                    disabled={busy}
                    onChange={() => {
                      setRsn(item.rsn);
                      setListed(new Set());
                      setFrom("");
                      setTo("");
                    }}
                  />
                  <span>{item.address}</span>
                </label>
              ))}
            </Stack>
          </fieldset>
        )}

        {screen.types && (
          <fieldset aria-labelledby="post-types" aria-describedby={problems.has("types") ? "post-types-error" : undefined}>
            <Stack gap="target">
              <legend id="post-types">
                {screen.types.legend} <span className="hub-flag__label">{screen.required}</span>
              </legend>
              {errorOf("types", screen.types.error, "post-types-error")}
              <Inline gap="target" wrap>
                {screen.types.items.map((item) => (
                  <label key={item.id} className="hub-choice">
                    <input type="checkbox" name="type" value={item.id} checked={types.has(item.id)} disabled={busy} onChange={(event) => setTypes((current) => toggle(current, item.id, event.target.checked))} />
                    <span>{item.more ? `${item.label} ${item.more}` : item.label}</span>
                  </label>
                ))}
              </Inline>
              <p>{screen.types.notOffered}</p>
            </Stack>
          </fieldset>
        )}

        {isOther && (
          <Stack gap="related" testId="post-other">
            <Not911 t={(key) => screen.other.not911[key]} />
            <p>{screen.other.hint}</p>
          </Stack>
        )}

        <fieldset aria-labelledby="post-floors" aria-describedby={problems.has("floors") || problems.has("range") ? "post-floors-error" : undefined}>
          <Stack gap="target">
            <legend id="post-floors">
              {screen.floors.legend} <span className="hub-flag__label">{screen.required}</span>
            </legend>
            {errorOf("floors", screen.floors.error, "post-floors-error")}
            {errorOf("range", screen.floors.rangeError, "post-floors-error")}
            <label className="hub-choice">
              <input type="radio" name="floors" value="all" checked={floorsMode === "all"} disabled={busy} onChange={() => setFloorsMode("all")} />
              <span>
                {screen.floors.whole} · {fill(screen.floors.allLine, { n: options.length })}
              </span>
            </label>
            <label className="hub-choice">
              <input type="radio" name="floors" value="list" checked={floorsMode === "list"} disabled={busy || options.length === 0} onChange={() => setFloorsMode("list")} />
              <span>
                {screen.floors.list.label} · {screen.floors.list.line}
              </span>
            </label>
            {floorsMode === "list" && (
              <Inline gap="target" wrap>
                {options.map((floor) => (
                  <label key={floor.id} className="hub-choice">
                    <input
                      type="checkbox"
                      name="floor"
                      value={floor.id}
                      aria-label={fill(screen.floors.floorAria, { n: floor.label })}
                      checked={listed.has(floor.id)}
                      disabled={busy}
                      onChange={(event) => setListed((current) => toggle(current, floor.id, event.target.checked))}
                    />
                    <span aria-hidden="true">{floor.label}</span>
                  </label>
                ))}
              </Inline>
            )}
            <label className="hub-choice">
              <input type="radio" name="floors" value="range" checked={floorsMode === "range"} disabled={busy || options.length === 0} onChange={() => setFloorsMode("range")} />
              <span>
                {screen.floors.range.label} · {screen.floors.range.line}
              </span>
            </label>
            {floorsMode === "range" && (
              <Inline gap="related" align="center" wrap>
                <label htmlFor="post-from">{screen.floors.range.from}</label>
                <select className="hub-input" id="post-from" value={from} disabled={busy} onChange={(event) => setFrom(event.target.value)}>
                  <option value="">{screen.floors.range.choose}</option>
                  {options.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.label}
                    </option>
                  ))}
                </select>
                <label htmlFor="post-to">{screen.floors.range.to}</label>
                <select className="hub-input" id="post-to" value={to} disabled={busy} onChange={(event) => setTo(event.target.value)}>
                  <option value="">{screen.floors.range.choose}</option>
                  {options.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.label}
                    </option>
                  ))}
                </select>
              </Inline>
            )}
          </Stack>
        </fieldset>

        <fieldset aria-labelledby="post-phase" aria-describedby={problems.has("phase") ? "post-phase-error" : undefined}>
          <Stack gap="target">
            <legend id="post-phase">
              {screen.phase.legend} <span className="hub-flag__label">{screen.required}</span>
            </legend>
            {errorOf("phase", screen.phase.error, "post-phase-error")}
            <label className="hub-choice">
              <input type="radio" name="phase" value="problem" checked={phase === "problem"} disabled={busy} onChange={() => setPhase("problem")} />
              <span>{screen.phase.problem}</span>
            </label>
            <label className="hub-choice">
              <input type="radio" name="phase" value="in_progress" checked={phase === "in_progress"} disabled={busy} onChange={() => setPhase("in_progress")} />
              <span>{screen.phase.progress}</span>
            </label>
          </Stack>
        </fieldset>

        <fieldset aria-labelledby="post-valid" aria-describedby={problems.has("valid") ? "post-valid-error" : undefined}>
          <Stack gap="target">
            <legend id="post-valid">{screen.valid.legend}</legend>
            {errorOf("valid", screen.errors.VALID_UNTIL_INVALID ?? screen.errors.fallback, "post-valid-error")}
            <label className="hub-choice">
              <input type="radio" name="valid-mode" value="resolved" checked={validMode === "resolved"} disabled={busy} onChange={() => setValidMode("resolved")} />
              <span>{screen.valid.resolved}</span>
            </label>
            <label className="hub-choice">
              <input type="radio" name="valid-mode" value="at" checked={validMode === "at"} disabled={busy} onChange={() => setValidMode("at")} />
              <span>{screen.valid.at}</span>
            </label>
            {validMode === "at" && (
              <Inline gap="related" align="center" wrap>
                <label htmlFor="post-date">{screen.valid.date}</label>
                <input id="post-date" className="hub-input" type="date" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} />
                <label htmlFor="post-time">{screen.valid.time}</label>
                <input id="post-time" className="hub-input" type="time" value={time} disabled={busy} onChange={(event) => setTime(event.target.value)} />
              </Inline>
            )}
            <p>{screen.valid.hint}</p>
          </Stack>
        </fieldset>

        <Stack gap="target">
          <label htmlFor="post-text">
            {isOther ? screen.other.textLabel : screen.text.label} <span className="hub-flag__label">{screen.required}</span>
          </label>
          {errorOf("text", screen.errors.TEXT_EMPTY ?? screen.errors.fallback, "post-text-error")}
          {errorOf("line", screen.other.error, "post-text-error")}
          {errorOf("tooLong", screen.errors.TEXT_TOO_LONG ?? screen.errors.fallback, "post-text-error")}
          <textarea
            id="post-text"
            className="hub-input"
            rows={4}
            value={text}
            disabled={busy}
            aria-describedby={problems.has("text") || problems.has("line") || problems.has("tooLong") ? "post-text-error post-text-hint" : "post-text-hint"}
            onChange={(event) => setText(event.target.value)}
          />
          <p id="post-text-hint">{screen.text.hint}</p>
          <Inline gap="target" wrap>
            {(isOther ? screen.other.phrases : screen.text.phrases).map((phrase) => (
              <button key={phrase} type="button" className="hub-button hub-button--secondary" disabled={busy} onClick={() => addPhrase(phrase)}>
                {phrase}
              </button>
            ))}
          </Inline>
        </Stack>

        <section aria-label={screen.bar.label} data-testid="post-bar">
          <Stack gap="related">
            <p data-testid="post-appears-as">{fill(screen.bar.appearsAs, { building: building?.address ?? "" })}</p>
            <p role="status">{screen.bar.outcome}</p>
            {state.kind === "unsent" && (
              <Stack gap="subline" testId="post-unsent">
                <p role="status" className="hub-flag">
                  {screen.status.unsent}
                </p>
                <p>{screen.status.unsentClose}</p>
              </Stack>
            )}
            {(state.kind === "sending" || state.kind === "working") && <p role="status">{screen.status.sending}</p>}
            {errorMessage && (
              <p role="alert" className="hub-error" data-testid="post-error">
                {errorMessage}
              </p>
            )}
            <Inline gap="target">
              <button className="hub-button hub-button--primary" type="button" disabled={busy} onClick={press}>
                {fill(screen.bar.button, { floors: chosenFloors() })}
              </button>
            </Inline>
          </Stack>
        </section>
      </Stack>
    </div>
  );
}
