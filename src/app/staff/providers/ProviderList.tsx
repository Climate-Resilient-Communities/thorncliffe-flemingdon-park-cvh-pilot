"use client";

import { useActionState, useState } from "react";
import { Inline, Stack } from "@/ui";
import { confirmProviderAction, publishProviderAction, unpublishProviderAction } from "./actions";
import type { ProviderActionState } from "./changeProvider";

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
  statusUnpublished: string;
  statusRemoved: string;
  removedNote: string;
  neverConfirmed: string;
  confirmDate: string;
  confirmedOn: string;
  dateHint: string;
  /** Beside a disabled Publish: why it is disabled. */
  confirmFirst: string;
  saveDate: string;
  publish: string;
  unpublish: string;
}

const IDLE: ProviderActionState = { status: "idle" };

/** One provider: its state and, for a provider in the catalogue, the date to set and the publish button. Listing text is not shown or editable. */
function ProviderRow({ row, today, labels }: { row: ProviderRowData; today: string; labels: ProviderListLabels }) {
  const [confirmState, confirm, confirming] = useActionState(confirmProviderAction, IDLE);
  const [publishState, publish, publishing] = useActionState(publishProviderAction, IDLE);
  const [unpublishState, unpublish, unpublishing] = useActionState(unpublishProviderAction, IDLE);
  // The answer of the button pressed last.
  const [last, setLast] = useState<"confirm" | "publish" | "unpublish" | null>(null);
  const answer = last === "confirm" ? confirmState : last === "publish" ? publishState : last === "unpublish" ? unpublishState : IDLE;
  const status = !row.inCatalogue ? labels.statusRemoved : row.published ? labels.statusPublished : labels.statusUnpublished;
  const busy = confirming || publishing || unpublishing;
  const messageId = `provider-${row.id}-message`;
  const errorId = `provider-${row.id}-error`;
  const publishHintId = `provider-${row.id}-publish-hint`;
  // A provider with no saved date cannot be published; the server refuses it too ("Confirm this provider first").
  const needsDate = !row.published && row.lastConfirmed === null;
  const dateHint = row.lastConfirmed === null ? labels.neverConfirmed : labels.dateHint;

  return (
    <li className="provider-record" data-testid={`provider-${row.id}`} data-published={row.published ? "true" : "false"} data-in-catalogue={row.inCatalogue ? "true" : "false"}>
      <Stack gap="related">
        <Inline gap="related" justify="between" align="baseline">
          <h2>{row.name}</h2>
          <strong data-testid={`provider-${row.id}-status`}>{status}</strong>
        </Inline>
        <p>{row.detail}</p>
        {!row.inCatalogue ? (
          <>
            <p data-testid={`provider-${row.id}-confirmed`}>{row.lastConfirmed === null ? labels.neverConfirmed : labels.confirmedOn.replace("{date}", row.lastConfirmed)}</p>
            <p>{labels.removedNote}</p>
          </>
        ) : (
          <div className="provider-record__actions">
            <form action={confirm} onSubmit={() => setLast("confirm")}>
              <input type="hidden" name="providerId" value={row.id} />
              <Stack gap="label">
                <label htmlFor={`confirm-${row.id}`}>{labels.confirmDate}</label>
                <Inline gap="target" align="end">
                  <input
                    className="hub-input"
                    id={`confirm-${row.id}`}
                    name="date"
                    type="date"
                    max={today}
                    required
                    defaultValue={row.lastConfirmed ?? undefined}
                    aria-describedby={`confirm-${row.id}-hint`}
                  />
                  <button className="hub-button hub-button--secondary" type="submit" disabled={busy}>
                    {labels.saveDate}
                  </button>
                </Inline>
                <small id={`confirm-${row.id}-hint`} data-testid={`provider-${row.id}-date-hint`}>
                  {dateHint}
                </small>
              </Stack>
            </form>
            <form action={row.published ? unpublish : publish} onSubmit={() => setLast(row.published ? "unpublish" : "publish")}>
              <input type="hidden" name="providerId" value={row.id} />
              <Stack gap="label">
                <div>
                  <button
                    className={`hub-button ${row.published ? "hub-button--secondary" : "hub-button--primary"}`}
                    type="submit"
                    disabled={busy || needsDate}
                    aria-describedby={needsDate ? publishHintId : undefined}
                  >
                    {row.published ? labels.unpublish : labels.publish}
                  </button>
                </div>
                {needsDate ? (
                  <small id={publishHintId} data-testid={`provider-${row.id}-publish-hint`}>
                    {labels.confirmFirst}
                  </small>
                ) : null}
              </Stack>
            </form>
          </div>
        )}
        {/* The status region is always in the page (a live region must exist before its text does); a refusal is a separate alert. */}
        <p id={messageId} role="status" data-testid={`provider-${row.id}-message`}>
          {answer.status === "done" ? answer.message : null}
        </p>
        {answer.status === "refused" ? (
          <p id={errorId} role="alert" className="hub-error" data-testid={`provider-${row.id}-error`}>
            {answer.message}
          </p>
        ) : null}
      </Stack>
    </li>
  );
}

/** The Admin's list of providers (S02.04). */
export function ProviderList({ rows, today, labels }: { rows: ProviderRowData[]; today: string; labels: ProviderListLabels }) {
  return (
    <Stack gap="section-hub" as="ul" testId="provider-list">
      {rows.map((row) => (
        <ProviderRow key={row.id} row={row} today={today} labels={labels} />
      ))}
    </Stack>
  );
}
