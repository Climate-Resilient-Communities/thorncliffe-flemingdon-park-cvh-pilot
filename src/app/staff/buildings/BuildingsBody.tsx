import { Stack } from "@/ui";
import type { EditState } from "./editFloors";
import { AddFloorForm, ConfirmForm, ContactForm, FloorRow, type FloorAction } from "./FloorForms";
import type { BuildingView, BuildingsScreen, ListView, MissingView } from "./view";

export interface BuildingActions {
  add: FloorAction;
  rename: FloorAction;
  remove: FloorAction;
  confirm: FloorAction;
  contact: FloorAction;
}

/** Test seam: forms already in the state they reach after a refusal (the screenshots show them). */
export interface BuildingsInitial {
  /** By floor id. */
  rename?: Record<string, EditState>;
  remove?: Record<string, EditState>;
  add?: EditState;
  confirm?: EditState;
  contact?: EditState;
}

function Notice({ text }: { text?: string }) {
  return text ? <p role="status">{text}</p> : null;
}

function List({ view }: { view: ListView }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <h1>{view.title}</h1>
        <p>{view.lead}</p>
        <Notice text={view.notice} />
      </Stack>
      {view.empty && <p>{view.empty}</p>}
      {view.groups.map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`}>
          <Stack gap="related">
            <h2 id={`group-${group.id}`}>
              {group.name} ({group.items.length})
            </h2>
            <Stack as="ul" gap="related">
              {group.items.map((item) => (
                <li key={item.rsn} className="hub-list-item" data-testid={`building-${item.rsn}`}>
                  <Stack gap="subline">
                    {/* A real link: a full page load, like the Hub's navigation. */}
                    <a className="tap hub-link" href={item.href} aria-label={item.linkLabel}>
                      {item.address}
                    </a>
                    <p>
                      {item.storeys}. {item.floors}. {item.status.text}.
                    </p>
                    {item.notInRegister && (
                      <p role="note" className="hub-flag">
                        <span className="hub-flag__label">{item.notInRegister.label}</span> {item.notInRegister.status}
                      </p>
                    )}
                  </Stack>
                </li>
              ))}
            </Stack>
          </Stack>
        </section>
      ))}
    </Stack>
  );
}

function Building({ view, actions, initial }: { view: BuildingView; actions: BuildingActions; initial?: BuildingsInitial }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <a className="tap hub-link" href={view.back.href}>
          {view.back.label}
        </a>
        <h1>{view.address}</h1>
        <p>
          {view.neighbourhood}. {view.status.text}.
        </p>
        <Notice text={view.notice} />
        {view.notInRegister && (
          <div role="note">
            <Stack gap="subline">
              <p>
                <strong>{view.notInRegister.title}</strong>
              </p>
              <p>{view.notInRegister.line}</p>
            </Stack>
          </div>
        )}
      </Stack>

      <section aria-labelledby="floors-title">
        <Stack gap="related">
          <h2 id="floors-title">{view.floors.title}</h2>
          <p>{view.floors.lead}</p>
          {view.floors.empty && <p>{view.floors.empty}</p>}
          <Stack as="ul" gap="related">
            {view.floors.rows.map((floor) => (
              <FloorRow
                key={floor.id}
                rsn={view.rsn}
                floor={floor}
                labels={view.floors}
                rename={actions.rename}
                remove={actions.remove}
                initialRename={initial?.rename?.[floor.id]}
                initialRemove={initial?.remove?.[floor.id]}
              />
            ))}
          </Stack>
        </Stack>
      </section>

      <AddFloorForm rsn={view.rsn} labels={view.add} action={actions.add} initialState={initial?.add} />
      {view.confirm && <ConfirmForm rsn={view.rsn} labels={view.confirm} action={actions.confirm} initialState={initial?.confirm} />}

      <ContactForm rsn={view.rsn} labels={view.contact} action={actions.contact} initialState={initial?.contact} />

      <section aria-labelledby="facts-title">
        <Stack gap="related">
          <h2 id="facts-title">{view.facts.title}</h2>
          <p>{view.facts.updated}</p>
          <Stack as="ul" gap="subline">
            {view.facts.items.map((item) => (
              <li key={item.label}>
                {item.label}: {item.value}
              </li>
            ))}
          </Stack>
        </Stack>
      </section>
    </Stack>
  );
}

function Missing({ view }: { view: MissingView }) {
  return (
    <Stack gap="related">
      <p role="alert">{view.message}</p>
      <a className="tap" href={view.back.href}>
        {view.back.label}
      </a>
    </Stack>
  );
}

/** The screen's body for a resolved view: the list of buildings, one building's editor, or a building that is not there. */
export function BuildingsBody({ screen, actions, initial }: { screen: BuildingsScreen; actions: BuildingActions; initial?: BuildingsInitial }) {
  if (screen.kind === "list") return <List view={screen} />;
  if (screen.kind === "building") return <Building view={screen} actions={actions} initial={initial} />;
  return <Missing view={screen} />;
}
