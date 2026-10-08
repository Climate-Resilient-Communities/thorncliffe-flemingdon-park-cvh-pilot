"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Staff navigation reloads session and safety banners; resident destinations cross root layouts. */

import { englishText } from "@/i18n/text";
import { useActionState, useState } from "react";
import { Stack, Verified } from "@/ui";
import { formatIsoDay } from "../day";
import { confirmProviderAction, publishProviderAction, unpublishProviderAction } from "./actions";
import type { ProviderActionState } from "./changeProvider";
import { RowActions } from "./RowActions";

export interface ProviderRowData {
  id: string;
  name: string;
  /** "Support & Emergency Services, Non-Profits" and the street, already joined. */
  detail: string;
  published: boolean;
  inCatalogue: boolean;
  lastConfirmed: string | null;
}

export interface ProviderListLabels {
  statusPublished: string;
  /** Not published: "Hidden". */
  statusUnpublished: string;
  statusRemoved: string;
  removedNote: string;
  /** "Confirmed {date}", the date written "Oct 2, 2026"; `{date}` stays for the row to fill. */
  confirmedOn: string;
  notConfirmed: string;
  /** Opens the date field of a confirmed provider ("Change") or of one with no date ("Confirm"). */
  change: string;
  confirm: string;
  confirmDate: string;
  /** "Today or earlier.": shown under the date field only with a refusal. */
  dateHint: string;
  /** Beside a disabled Publish: why it is disabled. */
  confirmFirst: string;
  saveDate: string;
  /** The actions menu's name, "Actions for {name}"; `{name}` stays for the row to fill. */
  actionsOf: string;
  publish: string;
  unpublish: string;
}

const IDLE: ProviderActionState = { status: "idle" };

/**
 * One provider, compact. Line 1: the name and a status pill ("Published", "Hidden", "Not in catalogue"), with the actions menu (⋯) that
 * holds Publish or Unpublish. Under it the code, categories and street, small and muted. Line 2: the verified badge with "Confirmed Oct 2,
 * 2026" or "Not confirmed" and "Change" (or "Confirm"), which opens the date field and Save date below it: a <details>, the app's
 * disclosure, so it works without scripts. Listing text is not shown or editable.
 */
function ProviderRow({ row, today, labels }: { row: ProviderRowData; today: string; labels: ProviderListLabels }) {
  const [confirmState, confirm, confirming] = useActionState(confirmProviderAction, IDLE);
  const [publishState, publish, publishing] = useActionState(publishProviderAction, IDLE);
  const [unpublishState, unpublish, unpublishing] = useActionState(unpublishProviderAction, IDLE);
  // The answer of the button pressed last.
  const [last, setLast] = useState<"confirm" | "publish" | "unpublish" | null>(null);
  // The date field stays open from the moment it was opened (the confirm answer of that moment) until a later answer saves the date.
  const [openedAt, setOpenedAt] = useState<ProviderActionState | null>(null);
  const answer = last === "confirm" ? confirmState : last === "publish" ? publishState : last === "unpublish" ? unpublishState : IDLE;
  const status = !row.inCatalogue ? labels.statusRemoved : row.published ? labels.statusPublished : labels.statusUnpublished;
  const pill = !row.inCatalogue ? "removed" : row.published ? "published" : "hidden";
  const busy = confirming || publishing || unpublishing;
  const messageId = `provider-${row.id}-message`;
  const errorId = `provider-${row.id}-error`;
  const hintId = `confirm-${row.id}-hint`;
  const publishHintId = `provider-${row.id}-publish-hint`;
  const confirmed = row.lastConfirmed !== null;
  // A provider with no saved date cannot be published; the server refuses it too ("Confirm this provider first").
  const needsDate = !row.published && !confirmed;
  const confirmRefused = last === "confirm" && confirmState.status === "refused";
  const editing = openedAt !== null && !(confirmState !== openedAt && confirmState.status === "done");
  const badgeText = row.lastConfirmed === null ? labels.notConfirmed : labels.confirmedOn.replace("{date}", formatIsoDay(row.lastConfirmed));

  return (
    <li
      className="provider-row"
      data-testid={`provider-${row.id}`}
      data-published={row.published ? "true" : "false"}
      data-in-catalogue={row.inCatalogue ? "true" : "false"}
      data-confirmed={confirmed ? "true" : "false"}
    >
      <div className="provider-row__head">
        <h2 className="provider-row__name">{row.name}</h2>
        <span className={`provider-pill provider-pill--${pill}`} data-testid={`provider-${row.id}-status`}>
          {status}
        </span>
        {row.inCatalogue ? (
          <RowActions label={labels.actionsOf.replace("{name}", row.name)} testId={`provider-${row.id}-actions`}>
            <form className="row-actions__form" action={row.published ? unpublish : publish} onSubmit={() => setLast(row.published ? "unpublish" : "publish")}>
              <input type="hidden" name="providerId" value={row.id} />
              <button className="hub-button hub-button--secondary row-actions__item" type="submit" disabled={busy || needsDate} aria-describedby={needsDate ? publishHintId : undefined}>
                {row.published ? labels.unpublish : labels.publish}
              </button>
              {needsDate ? (
                <small id={publishHintId} className="row-actions__hint" data-testid={`provider-${row.id}-publish-hint`}>
                  {labels.confirmFirst}
                </small>
              ) : null}
            </form>
          </RowActions>
        ) : null}
      </div>
      <p className="provider-row__detail">{row.detail}</p>
      {!row.inCatalogue ? (
        <>
          <Verified confirmed={confirmed} as="p" testId={`provider-${row.id}-confirmed`}>
            {badgeText}
          </Verified>
          <p className="provider-row__detail">{labels.removedNote}</p>
        </>
      ) : (
        <details
          className="provider-row__edit"
          open={editing}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            if (open !== editing) setOpenedAt(open ? confirmState : null);
          }}
        >
          {/* The badge's line is the disclosure's button: its words, then "Change" or "Confirm" drawn as a link. */}
          <summary className="provider-row__summary tap" data-testid={`provider-${row.id}-change`}>
            <Verified confirmed={confirmed} testId={`provider-${row.id}-confirmed`}>
              {badgeText}
            </Verified>
            <span className="provider-row__change">{confirmed ? labels.change : labels.confirm}</span>
          </summary>
          <form className="provider-row__form" action={confirm} onSubmit={() => setLast("confirm")}>
            <input type="hidden" name="providerId" value={row.id} />
            <label htmlFor={`confirm-${row.id}`} className="provider-row__label">
              {labels.confirmDate}
            </label>
            <div className="provider-row__fields">
              <input
                className="hub-input provider-row__date"
                id={`confirm-${row.id}`}
                name="date"
                type="date"
                max={today}
                required
                defaultValue={row.lastConfirmed ?? undefined}
                aria-describedby={confirmRefused ? `${hintId} ${errorId}` : undefined}
                aria-invalid={confirmRefused ? true : undefined}
              />
              <button className="hub-button hub-button--secondary provider-row__save" type="submit" disabled={busy}>
                {labels.saveDate}
              </button>
            </div>
            {confirmRefused ? (
              <small id={hintId} className="provider-row__hint" data-testid={`provider-${row.id}-date-hint`}>
                {labels.dateHint}
              </small>
            ) : null}
          </form>
        </details>
      )}
      {/* The status region is always in the page (a live region must exist before its text does); a refusal is a separate alert. */}
      <p id={messageId} role="status" className="provider-row__message" data-testid={`provider-${row.id}-message`}>
        {answer.status === "done" ? answer.message : null}
      </p>
      {answer.status === "refused" ? (
        <p id={errorId} role="alert" className="hub-error" data-testid={`provider-${row.id}-error`}>
          {answer.message}
        </p>
      ) : null}
    </li>
  );
}

/** The Admin's list of providers (S02.04), as the page's tabs and search left it; `empty` says why it has no row. */
export function ProviderList({ rows, today, labels, empty }: { rows: ProviderRowData[]; today: string; labels: ProviderListLabels; empty?: string }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <p>{englishText("staff.journey.publishReminder")}</p>
        <a className="hub-link tap" href="/staff/directory">{englishText("staff.journey.publishDirectory")}</a>
      </Stack>
      {rows.length === 0 ? (
        <p data-testid="provider-list-empty">{empty}</p>
      ) : (
        <ul className="provider-rows" data-testid="provider-list">
          {rows.map((row) => (
            <ProviderRow key={row.id} row={row} today={today} labels={labels} />
          ))}
        </ul>
      )}
    </Stack>
  );
}
