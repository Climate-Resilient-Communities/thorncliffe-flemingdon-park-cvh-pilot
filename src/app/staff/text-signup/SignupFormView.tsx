import { useState } from "react";
import { ResidentText, Stack } from "@/ui";
import type { SignupState } from "./control";
import type { BuildingOption, SignupFormLabels } from "./view";

/** What the resident reads on the staff member's screen, in the resident's language (the catalog's translated R-05 strings). */
export interface ResidentWords {
  /** The language's BCP-47 tag and direction, for the elements that hold the resident's words. */
  bcp47: string;
  dir: "ltr" | "rtl";
  /** "I am 16 or older, or a parent or guardian is helping me." */
  age: string;
  /** What happens next: reply YES within 48 hours. */
  expect: string;
  /** How to stop: reply STOP. */
  howStop: string;
}

export interface SignupFormProps {
  labels: SignupFormLabels;
  lang: string;
  consentVersion: string;
  neighbourhoods: readonly { id: string; name: string }[];
  buildings: readonly BuildingOption[];
  groups: readonly { id: string; name: string }[];
  resident: ResidentWords;
  /** The first step (choose the next resident's language). */
  nextHref: string;
}

const ERROR_ID = "text-signup-error";
const NUMBER_HINT_ID = "text-signup-number-hint";

/**
 * The fields of one sign-up. The building is optional and chooses the neighbourhood it is in; its floors are offered once it is chosen. Drawn
 * afresh (a new key) after each accepted sign-up, so the next resident starts from an empty form.
 */
function Fields({ props, busy, describedBy }: { props: SignupFormProps; busy: boolean; describedBy: string | undefined }) {
  const { labels, neighbourhoods, buildings, groups, resident } = props;
  const [nbhd, setNbhd] = useState("");
  const [rsn, setRsn] = useState("");
  const floors = buildings.find((b) => b.rsn === rsn)?.floors ?? [];
  const tag = (optional: boolean) => <span className="hub-flag__label">{optional ? labels.optional : labels.required}</span>;
  return (
    <Stack gap="stack">
      <input type="hidden" name="lang" value={props.lang} />
      <input type="hidden" name="consent_version" value={props.consentVersion} />
      <Stack gap="label">
        <label htmlFor="text-signup-phone">
          {labels.number} {tag(false)}
        </label>
        <input
          className="hub-input"
          id="text-signup-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          required
          maxLength={40}
          disabled={busy}
          aria-describedby={describedBy ? `${NUMBER_HINT_ID} ${describedBy}` : NUMBER_HINT_ID}
        />
        <small id={NUMBER_HINT_ID}>{labels.numberHint}</small>
      </Stack>
      <fieldset aria-labelledby="text-signup-nbhd">
        <Stack gap="target">
          <legend id="text-signup-nbhd">
            {labels.neighbourhood} {tag(false)}
          </legend>
          {neighbourhoods.map((n) => (
            <label key={n.id} className="hub-choice">
              <input type="radio" name="neighbourhood" value={n.id} required checked={nbhd === n.id} disabled={busy} onChange={() => setNbhd(n.id)} />
              <span>{n.name}</span>
            </label>
          ))}
        </Stack>
      </fieldset>
      <Stack gap="label">
        <label htmlFor="text-signup-building">
          {labels.building} {tag(true)}
        </label>
        <select
          className="hub-input"
          id="text-signup-building"
          name="building"
          value={rsn}
          disabled={busy}
          onChange={(event) => {
            const chosen = buildings.find((b) => b.rsn === event.target.value);
            setRsn(event.target.value);
            if (chosen) setNbhd(chosen.neighbourhoodId);
          }}
        >
          <option value="">{labels.buildingNone}</option>
          {neighbourhoods.map((n) => (
            <optgroup key={n.id} label={n.name}>
              {buildings
                .filter((b) => b.neighbourhoodId === n.id)
                .map((b) => (
                  <option key={b.rsn} value={b.rsn}>
                    {b.address}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </Stack>
      {floors.length > 0 && (
        <Stack gap="label">
          <label htmlFor="text-signup-floor">
            {labels.floor} {tag(true)}
          </label>
          <select className="hub-input" id="text-signup-floor" name="floor" defaultValue="" disabled={busy}>
            <option value="">{labels.floorNone}</option>
            {floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {labels.floorLabel.replace("{label}", floor.label)}
              </option>
            ))}
          </select>
        </Stack>
      )}
      <fieldset aria-labelledby="text-signup-groups">
        <Stack gap="target">
          <legend id="text-signup-groups">
            {labels.groups} {tag(true)}
          </legend>
          {groups.map((group) => (
            <label key={group.id} className="hub-choice">
              <input type="checkbox" name="groups" value={group.id} disabled={busy} />
              <span>{group.name}</span>
            </label>
          ))}
        </Stack>
      </fieldset>
      <label className="hub-check">
        <input type="checkbox" name="terms_agreed" value="yes" required disabled={busy} />
        <span>{labels.agreed}</span>
      </label>
      <Stack gap="related">
        <p>{labels.age}</p>
        <p lang={resident.bcp47} dir={resident.dir} className="hub-resident-words" data-testid="text-signup-age-statement">
          <ResidentText>{resident.age}</ResidentText>
        </p>
        <label className="hub-check">
          <input type="checkbox" name="age_confirmed" value="yes" required disabled={busy} />
          <span>{labels.ageConfirmed}</span>
        </label>
      </Stack>
      <div>
        <button className="hub-button hub-button--primary" type="submit" disabled={busy}>
          {busy ? labels.sending : labels.send}
        </button>
      </div>
    </Stack>
  );
}

/**
 * The Text sign-up form (S07.03) as it is drawn, with the answer of the last press: the same "done" for every accepted number (whether it is
 * new, already pending or already subscribed nothing tells), with what the resident must do next in their own language; or a refusal in the
 * Hub's error style. It holds no server behaviour, so the tests draw the very same markup. The number is never shown back.
 */
export function SignupFormView({ answer, busy = false, action, ...props }: SignupFormProps & { answer: SignupState; busy?: boolean; action?: (formData: FormData) => void }) {
  const { labels, resident } = props;
  const refused = answer.status === "refused";
  return (
    <Stack gap="section-hub" testId="text-signup-controls">
      <div aria-live="polite" data-testid="text-signup-answer">
        {answer.status === "done" ? (
          <div className="hub-flag" role="status">
            <Stack gap="related">
              <p>
                <strong className="hub-flag__label">{labels.doneTitle}</strong>
              </p>
              <p>{labels.done}</p>
              <p>{labels.doneYes}</p>
              <p>{labels.doneShow}</p>
              <div className="hub-resident-words" lang={resident.bcp47} dir={resident.dir} data-testid="text-signup-next-steps">
                <Stack gap="related">
                  <p>
                    <ResidentText>{resident.expect}</ResidentText>
                  </p>
                  <p>
                    <ResidentText>{resident.howStop}</ResidentText>
                  </p>
                </Stack>
              </div>
              <p>
                <a className="tap hub-link" href={props.nextHref}>{labels.next}</a>
              </p>
            </Stack>
          </div>
        ) : null}
      </div>
      {refused ? (
        <p id={ERROR_ID} role="alert" className="hub-error" data-testid="text-signup-error">
          {answer.message}
        </p>
      ) : null}
      <form action={action} className="hub-form">
        <Stack gap="stack">
          <h2>{labels.formHeading}</h2>
          <Fields key={answer.status === "done" ? answer.at : "form"} props={props} busy={busy} describedBy={refused ? ERROR_ID : undefined} />
        </Stack>
      </form>
      <small>
        {labels.limit} {labels.noList}
      </small>
    </Stack>
  );
}
