"use client";

import { useActionState, useState } from "react";
import { Inline, Stack } from "@/ui";
import { PlaceFields } from "../audience/AudienceForms";
import type { LogState } from "./logDisruption";
import type { LogScreen, TypeChoiceView } from "./view";

/** The server action behind the form (actions.ts): the form's last state and its data in, the new state out. */
export type LogAction = (previous: LogState, form: FormData) => Promise<LogState>;

const IDLE: LogState = { status: "idle" };

/** A group of types, each a checkbox in its own label (the label is the tap target). */
function TypeGroup({ id, label, items, ticked, onToggle, describedBy }: { id: string; label: string; items: TypeChoiceView[]; ticked: ReadonlySet<string>; onToggle: (id: string, on: boolean) => void; describedBy?: string }) {
  return (
    // A legend inside the Stack is not the fieldset's own legend, so the group is named by aria-labelledby.
    <fieldset aria-labelledby={id} aria-describedby={describedBy}>
      <Stack gap="target">
        <legend id={id}>{label}</legend>
        <Inline gap="target" wrap>
          {items.map((item) => (
            <label key={item.id} className="hub-choice">
              <input type="checkbox" name="type" value={item.id} checked={ticked.has(item.id)} onChange={(event) => onToggle(item.id, event.target.checked)} />
              <span>{item.label}</span>
            </label>
          ))}
        </Inline>
      </Stack>
    </fieldset>
  );
}

/**
 * "Log a disruption" (O-11, S04.05): the types (one or more), the place and the time of the first report in Toronto time, one form and
 * one Continue button. Every field is controlled, so a refusal that resets the form (React 19 resets a form after its action) leaves
 * what was typed. A time in the repeated hour of the clock change is asked about here, with the two readings, before anything is made.
 */
export function LogBody({ screen, action, initialState = IDLE }: { screen: LogScreen; action: LogAction; initialState?: LogState }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set([...screen.types.building.items, ...screen.types.neighbourhood.items].filter((item) => item.checked).map((item) => item.id)));
  const [date, setDate] = useState(screen.when.fields.date);
  const [time, setTime] = useState(screen.when.fields.time);
  const [fold, setFold] = useState<"" | "before" | "after">("");
  const toggle = (id: string, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const errorId = "log-error";
  const refused = state.status === "refused";
  return (
    // The page is one column with no grid cell around it: a word that cannot break (a long translated label) is wrapped here.
    <div className="hub-wrap">
      <Stack gap="section-hub-main">
        <Stack gap="related">
          <h1>{screen.title}</h1>
          <p>{screen.lead}</p>
          <p className="hub-flag" role="note">
            {screen.benchmark}
          </p>
        </Stack>
        <form action={formAction}>
          <Stack gap="section-hub-main">
            <input type="hidden" name="kind" value={screen.kind} />
            {refused && (
              <p id={errorId} role="alert" className="hub-error">
                {state.message}
              </p>
            )}
            <section aria-labelledby="log-types">
              <Stack gap="related">
                <h2 id="log-types">{screen.types.title}</h2>
                <p>{screen.types.hint}</p>
                <TypeGroup id="log-types-building" label={screen.types.building.label} items={screen.types.building.items} ticked={ticked} onToggle={toggle} describedBy={refused ? errorId : undefined} />
                <TypeGroup id="log-types-neighbourhood" label={screen.types.neighbourhood.label} items={screen.types.neighbourhood.items} ticked={ticked} onToggle={toggle} />
                <p>{screen.types.neighbourhood.hint}</p>
              </Stack>
            </section>
            <section aria-labelledby="log-place">
              <Stack gap="stack">
                <Stack gap="related">
                  <h2 id="log-place">{screen.place.title}</h2>
                  <p>{screen.place.hint}</p>
                </Stack>
                <PlaceFields screen={screen.place.fields} describedBy={refused ? errorId : undefined} />
              </Stack>
            </section>
            <section aria-labelledby="log-when">
              <Stack gap="related">
                <h2 id="log-when">{screen.when.title}</h2>
                <p>{screen.when.hint}</p>
                <Inline gap="related" align="center" wrap>
                  <label htmlFor="reported-date">{screen.when.dateLabel}</label>
                  <input
                    id="reported-date"
                    className="hub-input"
                    type="date"
                    name="reported-date"
                    value={date}
                    required
                    onChange={(event) => {
                      setDate(event.target.value);
                      setFold("");
                    }}
                  />
                  <label htmlFor="reported-time">{screen.when.timeLabel}</label>
                  <input
                    id="reported-time"
                    className="hub-input"
                    type="time"
                    name="reported-time"
                    value={time}
                    required
                    onChange={(event) => {
                      setTime(event.target.value);
                      setFold("");
                    }}
                  />
                </Inline>
                {state.status === "ask" && (
                  <fieldset aria-labelledby="log-fold-legend">
                    <Stack gap="target">
                      <legend id="log-fold-legend">{screen.when.foldLegend}</legend>
                      <p role="alert" className="hub-error">
                        {state.question}
                      </p>
                      <label className="hub-choice">
                        <input type="radio" name="reported-fold" value="before" checked={fold === "before"} required onChange={() => setFold("before")} />
                        <span>{state.before}</span>
                      </label>
                      <label className="hub-choice">
                        <input type="radio" name="reported-fold" value="after" checked={fold === "after"} onChange={() => setFold("after")} />
                        <span>{state.after}</span>
                      </label>
                    </Stack>
                  </fieldset>
                )}
              </Stack>
            </section>
            <Inline gap="target" align="center">
              <button className="hub-button hub-button--primary" type="submit" disabled={pending}>
                {screen.submit}
              </button>
            </Inline>
          </Stack>
        </form>
      </Stack>
    </div>
  );
}
