import { englishText } from "@/i18n/text";
import { deadlineForStaff, isDeadlineDate, type CampaignRefusal, type Campaigns } from "@/modules/subscriptions";
import type { StaffSession } from "../session";

/**
 * What a press answers. Every text is already resolved from the catalog. `done` lists lines to read (the first says what happened); `refused` is one message in
 * the Hub's error style: nothing was changed.
 */
export type CampaignAnswer = { status: "done"; lines: string[] } | { status: "refused"; message: string };

/** What the page's forms show: nothing yet, or the last answer of any of its buttons with the time (`at`, milliseconds) it was given. */
export type CampaignState = { status: "idle" } | (CampaignAnswer & { at: number });

export interface ControlDeps {
  campaigns: () => Campaigns;
  /** Starts a dispatcher run once texts are queued (`kickDispatcher`): never inside the transaction, never throws. */
  startSending: () => Promise<void>;
  /** Operational error log (structured, no personal data): the error's name only. */
  logError: (event: string, fields: Record<string, string>) => void;
}

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.campaign.${key}`, values);

const nameOfError = (error: unknown) => (error instanceof Error ? error.name : "NonError");

/** The words of a refusal; the deadline that changed is named. */
export function refusalMessage(reason: CampaignRefusal, deadlineDate?: string): string {
  return t(`errors.${reason}`, reason === "deadline_changed" && deadlineDate && isDeadlineDate(deadlineDate) ? { date: deadlineForStaff(deadlineDate) } : {});
}

const field = (form: FormData, name: string): string | null => {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
};

/** "Rehearse on the drill roster", for the Admin at aal2 the guard let through, with the page's idempotency key and the deadline it showed. */
export async function rehearseFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId" | "sessionId">, form: FormData): Promise<CampaignAnswer> {
  try {
    const outcome = await deps
      .campaigns()
      .rehearse({ actorStaffId: session.staffId, sessionId: session.sessionId, idempotencyKey: field(form, "key"), deadlineSeen: field(form, "deadline") });
    if (outcome.kind === "refused") return { status: "refused", message: refusalMessage(outcome.reason, outcome.deadlineDate) };
    if (outcome.replayed) return { status: "done", lines: [t("done.rehearsedAlready")] };
    if (outcome.texts > 0) await deps.startSending().catch((error: unknown) => deps.logError("campaign.kick_failed", { error: nameOfError(error) }));
    return { status: "done", lines: [outcome.texts === 0 ? t("done.rehearsedNone") : outcome.texts === 1 ? t("done.rehearsedOne") : t("done.rehearsed", { n: outcome.texts })] };
  } catch (error) {
    deps.logError("campaign.rehearse_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.failed") };
  }
}

/**
 * "Start the campaign", for the same Admin: the idempotency key and the deadline the page showed, and the box they ticked. Once the start has committed a run of
 * the dispatcher is started; if it cannot be, the start still stands (pg_cron's next run sends the texts) and the failure is logged.
 */
export async function startFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId" | "sessionId">, form: FormData): Promise<CampaignAnswer> {
  try {
    const outcome = await deps.campaigns().start({
      actorStaffId: session.staffId,
      sessionId: session.sessionId,
      idempotencyKey: field(form, "key"),
      deadlineSeen: field(form, "deadline"),
      confirmed: field(form, "confirm") === "yes",
    });
    if (outcome.kind === "refused") return { status: "refused", message: refusalMessage(outcome.reason, outcome.deadlineDate) };
    if (outcome.kind === "already_started") return { status: "done", lines: [t("done.alreadyStarted")] };
    await deps.startSending().catch((error: unknown) => deps.logError("campaign.kick_failed", { error: nameOfError(error) }));
    return { status: "done", lines: [t("done.started", { asked: outcome.asked, texts: outcome.texts, deleted: outcome.pendingDeleted })] };
  } catch (error) {
    deps.logError("campaign.start_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.failed") };
  }
}

/** "Reopen sign-ups for the MVP", for the same Admin, after the campaign ended. */
export async function reopenFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">): Promise<CampaignAnswer> {
  try {
    const outcome = await deps.campaigns().reopenSignups({ actorStaffId: session.staffId });
    if (outcome.kind === "refused") return { status: "refused", message: refusalMessage(outcome.reason) };
    return { status: "done", lines: [t("done.reopened")] };
  } catch (error) {
    deps.logError("campaign.reopen_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.failed") };
  }
}
