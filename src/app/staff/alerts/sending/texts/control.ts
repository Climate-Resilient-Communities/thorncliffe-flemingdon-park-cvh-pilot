// What a press of "Resend" answers (S09.02): the form's fields read, the messaging module's resend run as the Admin the guard let through, and its outcome put in the
// Hub's words. Pure of Next.js, so the tests call it directly. The guard (../../../guard.ts) has already refused everyone but an Admin at aal2; the actor is its session's,
// never the form's.
import { englishText } from "@/i18n/text";
import { bucketOf, type DeliveryState, type Resend, type ResendOutcome } from "@/modules/messaging";
import { formatCents } from "../../approval/view";
import { meaningText } from "../view";
import type { StaffSession } from "../../../session";

/** What a press answers, already in words: `done` lists lines to read; `refused` is one message in the Hub's error style (nothing was resent). */
export type ResendAnswer = { status: "done"; lines: string[] } | { status: "refused"; message: string };

/** What a resend form shows: nothing yet, or the last answer with the time it was given. */
export type ResendState = { status: "idle" } | (ResendAnswer & { at: number });

export interface ControlDeps {
  resend: () => Resend;
  /** Starts a dispatcher run once a resend has committed (`kickDispatcher`): never inside the transaction, never throws. */
  startSending: () => Promise<void>;
  /** Operational error log (structured, no personal data): the error's name only. */
  logError: (event: string, fields: Record<string, string>) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LANG = /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/;

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.sending.resend.${key}`, values);
const nameOfError = (error: unknown) => (error instanceof Error ? error.name : "NonError");
const field = (form: FormData, name: string): string | null => {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
};

/** A delivery state in the words of the counts ("Delivered", "Failed", "Waiting"). */
const statusWord = (state: string): string => englishText(`staff.sending.counts.${bucketOf(state as DeliveryState, false)}`).toLowerCase();

const invalid = (): ResendAnswer => ({ status: "refused", message: t("errors.invalid") });

/** An outcome in words. */
export function answerOf(outcome: ResendOutcome, seen: string | null = null): ResendAnswer {
  if (outcome.kind === "refused") {
    const values: Record<string, string | number> = {};
    if (outcome.status) values.status = statusWord(outcome.status);
    if (seen) values.seen = statusWord(seen);
    if (outcome.meaning) values.reason = meaningText(outcome.meaning, null);
    if (outcome.cause) values.cause = t(`cause.${outcome.cause}`);
    return { status: "refused", message: t(`refused.${outcome.reason}`, values) };
  }
  const lines: string[] = [];
  if (outcome.resent === 0) lines.push(t("done.none"));
  else lines.push(outcome.resent === 1 ? t("done.one") : t("done.many", { n: outcome.resent }));
  const left = outcome.notResent.reduce((sum, item) => sum + item.n, 0);
  if (left > 0) lines.push(t("done.left", { n: left, reasons: outcome.notResent.map((item) => `${item.n} ${t(`left.${item.reason}`)}`).join(", ") }));
  if (outcome.more) lines.push(t("done.more"));
  if (outcome.overrun) lines.push(t("done.overrun", { over: `${formatCents(outcome.overrun.overCents)} CAD`, cap: `${formatCents(outcome.overrun.capCents)} CAD` }));
  return { status: "done", lines };
}

async function run(deps: ControlDeps, call: () => Promise<ResendOutcome>, seen: string | null): Promise<ResendAnswer> {
  try {
    const outcome = await call();
    // Texts that were resent are due now: start a run so they do not wait for pg_cron's next minute. After the commit, and it never throws.
    if (outcome.kind === "resent" && outcome.resent > 0) await deps.startSending();
    return answerOf(outcome, seen);
  } catch (error) {
    deps.logError("messaging.resend_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.failed") };
  }
}

/** "Resend" on one text: the entry and the text from the form, the status the Admin saw, and (for an unknown text) their confirmation. */
export async function resendOneFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<ResendAnswer> {
  const entryId = field(form, "entry");
  const deliveryId = field(form, "delivery");
  if (entryId === null || deliveryId === null || !UUID.test(entryId) || !UUID.test(deliveryId)) return invalid();
  const seen = field(form, "seen");
  return run(
    deps,
    () => deps.resend().resend({ actorStaffId: session.staffId, entryId, scope: "one", deliveryId, seen, confirmedUnknown: field(form, "confirm") === "on" }),
    seen,
  );
}

/** "Resend the failed and undelivered texts in {language}" for the entry the form names. */
export async function resendAllFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<ResendAnswer> {
  const entryId = field(form, "entry");
  const lang = field(form, "lang");
  if (entryId === null || lang === null || !UUID.test(entryId) || !LANG.test(lang)) return invalid();
  return run(deps, () => deps.resend().resend({ actorStaffId: session.staffId, entryId, scope: "language", lang }), null);
}
