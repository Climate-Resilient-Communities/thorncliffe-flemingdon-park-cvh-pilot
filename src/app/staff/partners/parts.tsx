// The building blocks of the Hub and partner space's screens (2026-11-07): the heading with the area's band, the links between the area's
// pages, a space's card, its change form and the notice a change leaves. Server components: every word is resolved here from the English
// catalog, and every form posts to a server action, so the screens work before (and without) any script.
import type { ReactNode } from "react";
import { englishText } from "@/i18n/text";
import { MAX_CAPACITY, SPACE_PURPOSES, SPACE_STATUSES, type SpaceRow } from "@/modules/partners";
import { Stack } from "@/ui";
import { changeSpaceAction, setSpaceStatusAction, type SpaceFormState } from "./actions";

/** The state every form starts from (the actions' first argument): they post as plain forms and come back to their page. */
const IDLE: SpaceFormState = { status: "idle" };

// A plain form's action answers nothing the page reads: each change goes back to its page with a notice (actions.ts), so the state an action
// returns (only for someone at a setup gate) is dropped here, and React's form action type, which wants no answer, is met by the cast.
const changeForm = changeSpaceAction.bind(null, IDLE) as unknown as (form: FormData) => Promise<void>;
const setStatusForm = setSpaceStatusAction.bind(null, IDLE) as unknown as (form: FormData) => Promise<void>;
import { purposeLabel, statusLabel, type ChangeNotice, type SpaceView } from "./view";
import { pw } from "./words";

/** The heading of an area page, its lead, and who can see the area: the prototype's partner band, or the readiness band between disruptions. */
export function AreaHeading({ title, lead, area }: { title: string; lead?: string; area: "disruption" | "readiness" }) {
  const [band, line] = area === "disruption" ? ["hub.partnerBand", "hub.partnerBandLine"] : ["hub.readinessBand", "hub.readinessBandLine"];
  return (
    <Stack gap="related">
      <h1 className="hub-wrap">{title}</h1>
      {lead && <p>{lead}</p>}
      <p className="hub-flag hub-wrap" data-testid="area-band">
        <span className="hub-flag__label">{englishText(band)}.</span> {englishText(line)}
      </p>
    </Stack>
  );
}

/** The links to the area's other pages, as secondary buttons in a row that wraps. */
export function AreaLinks({ label, links }: { label: string; links: readonly { href: string; label: string }[] }) {
  return (
    <nav aria-label={label}>
      <ul className="hub-actions">
        {links.map((link) => (
          <li key={link.href}>
            <a className="tap hub-button hub-button--secondary" href={link.href}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A status, a coverage group or a commitment's answer, in words on a pill. */
export function Pill({ tone, children, testId }: { tone: string; children: ReactNode; testId?: string }) {
  return (
    <span className={`hub-pill hub-pill--${tone}`} data-testid={testId}>
      {children}
    </span>
  );
}

/** What a change did, at the top of the page it came back to: a status line, or a refusal as an alert. */
export function ChangeNoticeLine({ notice }: { notice: ChangeNotice | null }) {
  if (!notice) return null;
  return notice.kind === "done" ? (
    <p role="status" className="hub-cover hub-cover--covered hub-wrap" data-testid="space-notice">
      {notice.message}
    </p>
  ) : (
    <p role="alert" className="hub-error hub-wrap" data-testid="space-notice">
      {notice.message}
    </p>
  );
}

/** A form's hidden fields: which space, and the page to come back to. */
function Hidden({ spaceId, back }: { spaceId: string; back: string }) {
  return (
    <>
      <input type="hidden" name="spaceId" value={spaceId} />
      <input type="hidden" name="back" value={back} />
    </>
  );
}

/** P-07's one-tap buttons: Open, Full, Closed (the one it is now is left out) and "Still correct", each its own form. */
export function QuickStatus({ space, back }: { space: SpaceView; back: string }) {
  const buttons = (["open", "full", "closed"] as const).filter((status) => status !== space.status);
  return (
    <ul className="hub-actions" aria-label={englishText("P07.state")}>
      {buttons.map((status) => (
        <li key={status}>
          <form action={setStatusForm}>
            <Hidden spaceId={space.id} back={back} />
            <input type="hidden" name="status" value={status} />
            <button type="submit" className="tap hub-button hub-button--secondary" data-testid={`set-${status}-${space.id}`}>
              {pw("board.setTo", { status: statusLabel(status) })}
            </button>
          </form>
        </li>
      ))}
      {space.shown && (
        <li>
          <form action={setStatusForm}>
            <Hidden spaceId={space.id} back={back} />
            <input type="hidden" name="status" value="confirm" />
            <button type="submit" className="tap hub-button hub-button--primary" data-testid={`confirm-${space.id}`}>
              {englishText("P07.stillCorrect")}
            </button>
          </form>
        </li>
      )}
    </ul>
  );
}

/**
 * The change form of a space (P-06, and P-01 with the status fixed to Open): status, purpose, the room's limit and the people there now. Every
 * field starts at the space as it is; saving confirms it as it stands, whatever changed.
 */
export function SpaceForm({ space, back, openOnly = false }: { space: SpaceRow; back: string; openOnly?: boolean }) {
  const id = (name: string) => `${name}-${space.id}`;
  return (
    <form action={changeForm} className="hub-form" data-testid={`space-form-${space.id}`}>
      <Stack gap="related">
        <Hidden spaceId={space.id} back={back} />
        {openOnly ? (
          <input type="hidden" name="status" value="open" />
        ) : (
          <fieldset>
            <legend className="hub-card__title">{englishText("P07.state")}</legend>
            <Stack gap="subline">
              {SPACE_STATUSES.map((status) => (
                <label key={status} className="hub-choice">
                  <input type="radio" name="status" value={status} defaultChecked={space.status === status} />
                  <span>{statusLabel(status)}</span>
                </label>
              ))}
            </Stack>
          </fieldset>
        )}
        <Stack gap="subline">
          <label htmlFor={id("purpose")}>{pw("form.purpose")}</label>
          <select className="hub-input" id={id("purpose")} name="purpose" defaultValue={space.purpose}>
            {SPACE_PURPOSES.map((purpose) => (
              <option key={purpose} value={purpose}>
                {purposeLabel(purpose)}
              </option>
            ))}
          </select>
        </Stack>
        <Stack gap="subline">
          <label htmlFor={id("max")}>{pw("form.capacityMax")}</label>
          <input className="hub-input" id={id("max")} name="capacityMax" type="number" inputMode="numeric" min={1} max={MAX_CAPACITY} required defaultValue={space.capacityMax} />
        </Stack>
        <Stack gap="subline">
          <label htmlFor={id("now")}>{englishText("P07.capacity")}</label>
          <input className="hub-input" id={id("now")} name="capacityNow" type="number" inputMode="numeric" min={0} max={MAX_CAPACITY} defaultValue={space.capacityNow ?? ""} aria-describedby={id("now-hint")} />
          <small id={id("now-hint")}>{pw("form.capacityNowHint")}</small>
        </Stack>
        <button type="submit" className="tap hub-button hub-button--primary" data-testid={`save-${space.id}`}>
          {openOnly ? pw("open.submit") : pw("form.submit")}
        </button>
      </Stack>
    </form>
  );
}

/** A space as a card: its status and purpose, where, who runs it, how full and who confirmed it when; then whatever the page puts under it. */
export function SpaceCard({ view, children }: { view: SpaceView; children?: ReactNode }) {
  return (
    <li id={`space-${view.id}`} className={`hub-card hub-card--${view.status}`} data-testid={`space-${view.id}`} data-status={view.status}>
      <Stack gap="subline">
        <div className="hub-card__head">
          <span className="hub-card__title">
            <a className="hub-link" href={view.href}>
              {view.name}
            </a>
          </span>
          <span className="hub-actions">
            <Pill tone={view.status} testId={`status-${view.id}`}>
              {view.statusLabel}
            </Pill>
            <span>{view.purposeLabel}</span>
          </span>
        </div>
        <p className="hub-card__meta">
          {view.where} · {view.runBy}
        </p>
        <p className="hub-wrap">{view.capacity}</p>
        {view.hours && <p className="hub-wrap">{view.hours}</p>}
        <p className="hub-card__meta">{view.confirmed}</p>
        {view.unconfirmed && (
          <p className="hub-flag hub-wrap">
            <span className="hub-flag__label">{view.unconfirmed}.</span> {englishText("P07.staleLine")}
          </p>
        )}
        {view.atLimit && <p className="hub-flag hub-wrap">{englishText("P07.capAtMax")}</p>}
        {children}
      </Stack>
    </li>
  );
}
