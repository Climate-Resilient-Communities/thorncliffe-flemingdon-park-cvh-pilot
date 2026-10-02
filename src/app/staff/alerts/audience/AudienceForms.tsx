"use client";

import { useActionState, useState } from "react";
import { Inline, Stack } from "@/ui";
import type { AudienceState } from "./editAudience";
import type { BuildingRowView, GroupsScreen, PlaceScreen } from "./view";

/** An audience form's server action (actions.ts): the form's last state and its data in, the new state out. */
export type AudienceAction = (previous: AudienceState, form: FormData) => Promise<AudienceState>;

const IDLE: AudienceState = { status: "idle" };

function Refusal({ id, state }: { id: string; state: AudienceState }) {
  if (state.status !== "refused") return null;
  return (
    <p id={id} role="alert" className="hub-error">
      {state.message}
    </p>
  );
}

/** Adds or removes one value of a set held in state. */
function toggled(values: ReadonlySet<string>, value: string, on: boolean): Set<string> {
  const next = new Set(values);
  if (on) next.add(value);
  else next.delete(value);
  return next;
}

/**
 * One building of the picker: ticked or not, and when ticked the whole building or some floors (ticked, or a range from
 * one floor to another in the building's own order). Every control is controlled by this row's state, so a refusal that
 * resets the form (React 19 resets a form after its action) leaves the choices as they were. The floor controls are
 * always in the page, inside a <details> that is open for a ticked building, so they work before the page is hydrated.
 */
function BuildingRow({ row, labels }: { row: BuildingRowView; labels: PlaceScreen["floorLabels"] }) {
  const [checked, setChecked] = useState(row.checked);
  const [whole, setWhole] = useState(row.whole || row.floors.length === 0);
  const [floors, setFloors] = useState<ReadonlySet<string>>(new Set(row.floors.filter((floor) => floor.checked).map((floor) => floor.id)));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const name = (field: string) => `${field}-${row.rsn}`;
  return (
    <li className="hub-list-item" data-testid={`building-${row.rsn}`}>
      <Stack gap="related">
        <label className="hub-choice">
          <input type="checkbox" name="building" value={row.rsn} checked={checked} onChange={(event) => setChecked(event.target.checked)} /> {row.address}
        </label>
        <details open={checked || undefined}>
          <summary className="tap hub-link">{labels.some}</summary>
          <Stack gap="related">
            <fieldset>
              <Stack gap="target">
                <legend>{row.floorsLegend}</legend>
                <label className="hub-choice">
                  <input type="radio" name={name("floors")} value="all" checked={whole} onChange={() => setWhole(true)} /> {labels.whole}
                </label>
                <label className="hub-choice">
                  <input type="radio" name={name("floors")} value="some" checked={!whole} disabled={row.floors.length === 0} onChange={() => setWhole(false)} /> {labels.some}
                </label>
                {row.noFloors && <p>{row.noFloors}</p>}
              </Stack>
            </fieldset>
            {row.floors.length > 0 && (
              <>
                <fieldset>
                  <Stack gap="label">
                    <legend>{labels.pick}</legend>
                    <Inline gap="target" wrap>
                      {row.floors.map((floor) => (
                        <label key={floor.id} className="hub-choice">
                          <input
                            type="checkbox"
                            name={name("floor")}
                            value={floor.id}
                            checked={floors.has(floor.id)}
                            onChange={(event) => {
                              setFloors(toggled(floors, floor.id, event.target.checked));
                              if (event.target.checked) setWhole(false);
                            }}
                          />{" "}
                          {floor.label}
                        </label>
                      ))}
                    </Inline>
                  </Stack>
                </fieldset>
                <fieldset>
                  <Stack gap="label">
                    <legend>{labels.range}</legend>
                    <Inline gap="related" align="center" wrap>
                      <label htmlFor={`from-${row.rsn}`}>{labels.from}</label>
                      <select
                        className="hub-input"
                        id={`from-${row.rsn}`}
                        name={name("from")}
                        value={from}
                        onChange={(event) => {
                          setFrom(event.target.value);
                          if (event.target.value !== "") setWhole(false);
                        }}
                      >
                        <option value="">{labels.none}</option>
                        {row.floors.map((floor) => (
                          <option key={floor.id} value={floor.id}>
                            {floor.label}
                          </option>
                        ))}
                      </select>
                      <label htmlFor={`to-${row.rsn}`}>{labels.to}</label>
                      <select
                        className="hub-input"
                        id={`to-${row.rsn}`}
                        name={name("to")}
                        value={to}
                        onChange={(event) => {
                          setTo(event.target.value);
                          if (event.target.value !== "") setWhole(false);
                        }}
                      >
                        <option value="">{labels.none}</option>
                        {row.floors.map((floor) => (
                          <option key={floor.id} value={floor.id}>
                            {floor.label}
                          </option>
                        ))}
                      </select>
                    </Inline>
                  </Stack>
                </fieldset>
              </>
            )}
          </Stack>
        </details>
      </Stack>
    </li>
  );
}

/**
 * The place picker's form (O-03): a whole neighbourhood, or buildings each with the whole building or some floors. The
 * scope is chosen, not assumed: neither is selected to begin with for a draft with no place, and a form sent without
 * one is refused. One form with one Save button; the choices are judged by the server.
 */
export function PlaceForm({ screen, action, initialState = IDLE }: { screen: PlaceScreen; action: AudienceAction; initialState?: AudienceState }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [scope, setScope] = useState<"neighbourhood" | "buildings" | "">(screen.scope.neighbourhood.checked ? "neighbourhood" : screen.scope.buildings.checked ? "buildings" : "");
  const [neighbourhoods, setNeighbourhoods] = useState<ReadonlySet<string>>(new Set(screen.neighbourhoods.items.filter((n) => n.checked).map((n) => n.id)));
  const errorId = "audience-error";
  return (
    <form action={formAction}>
      <Stack gap="section-hub-main">
        <input type="hidden" name="alert" value={screen.ref.alertId} />
        <input type="hidden" name="entry" value={screen.ref.entryId} />
        <Refusal id={errorId} state={state} />

        <fieldset>
          <Stack gap="target">
            <legend>{screen.scope.title}</legend>
            <label className="hub-choice">
              <input type="radio" name="scope" value="neighbourhood" checked={scope === "neighbourhood"} onChange={() => setScope("neighbourhood")} aria-describedby={state.status === "refused" ? errorId : undefined} />
              <span>
                {screen.scope.neighbourhood.label}. {screen.scope.neighbourhood.line}
              </span>
            </label>
            <label className="hub-choice">
              <input type="radio" name="scope" value="buildings" checked={scope === "buildings"} onChange={() => setScope("buildings")} />
              <span>
                {screen.scope.buildings.label}. {screen.scope.buildings.line}
              </span>
            </label>
          </Stack>
        </fieldset>

        <section aria-labelledby="audience-neighbourhoods">
          <Stack gap="related">
            <h2 id="audience-neighbourhoods">{screen.neighbourhoods.title}</h2>
            <Inline gap="target" wrap>
              {screen.neighbourhoods.items.map((item) => (
                <label key={item.id} className="hub-choice">
                  <input
                    type="checkbox"
                    name="neighbourhood"
                    value={item.id}
                    checked={neighbourhoods.has(item.id)}
                    onChange={(event) => {
                      setNeighbourhoods(toggled(neighbourhoods, item.id, event.target.checked));
                      if (event.target.checked) setScope("neighbourhood");
                    }}
                  />
                  <span>
                    {item.name}. {item.line}
                  </span>
                </label>
              ))}
            </Inline>
          </Stack>
        </section>

        <section aria-labelledby="audience-buildings">
          <Stack gap="stack">
            <Stack gap="related">
              <h2 id="audience-buildings">{screen.buildingsSection.title}</h2>
              <p>{screen.buildingsSection.hint}</p>
            </Stack>
            {screen.buildingsSection.groups.map((group) => (
              <section key={group.id} aria-labelledby={`audience-group-${group.id}`}>
                <Stack gap="related">
                  <h3 id={`audience-group-${group.id}`}>{group.title}</h3>
                  <Stack as="ul" gap="related">
                    {group.rows.map((row) => (
                      <BuildingRow key={row.rsn} row={row} labels={screen.floorLabels} />
                    ))}
                  </Stack>
                </Stack>
              </section>
            ))}
          </Stack>
        </section>

        <Inline gap="target" align="center">
          <button className="hub-button hub-button--primary" type="submit" disabled={pending}>
            {screen.submit}
          </button>
        </Inline>
      </Stack>
    </form>
  );
}

/**
 * The group picker's form (O-04): the groups residents chose to join, ticked or not; none ticked is no narrowing.
 * Controlled, like the place picker, so a refusal leaves the ticks as they were.
 */
export function GroupsForm({ screen, action, initialState = IDLE }: { screen: GroupsScreen; action: AudienceAction; initialState?: AudienceState }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(screen.groups.filter((group) => group.checked).map((group) => group.id)));
  const errorId = "groups-error";
  return (
    <form action={formAction}>
      <Stack gap="stack">
        <input type="hidden" name="alert" value={screen.ref.alertId} />
        <input type="hidden" name="entry" value={screen.ref.entryId} />
        <Refusal id={errorId} state={state} />
        <fieldset aria-describedby={state.status === "refused" ? errorId : undefined}>
          <Stack gap="target">
            <legend>{screen.legend}</legend>
            <p>{screen.hint}</p>
            {screen.groups.map((group) => (
              <label key={group.id} className="hub-choice">
                <input type="checkbox" name="group" value={group.id} checked={chosen.has(group.id)} onChange={(event) => setChosen(toggled(chosen, group.id, event.target.checked))} />
                <span>
                  {group.label}. {group.line}
                </span>
              </label>
            ))}
          </Stack>
        </fieldset>
        <Inline gap="target" align="center">
          <button className="hub-button hub-button--primary" type="submit" disabled={pending}>
            {screen.submit}
          </button>
        </Inline>
      </Stack>
    </form>
  );
}
