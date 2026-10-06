import { maskPhoneNumbers } from "../../messaging";
import { redactEditTokens } from "../domain/editLink";

type Fields = Record<string, string | number | boolean | null>;

/** Where subscriptions reports what its public routes did (S07.06's edit link): the outcome only, never a number, a token or an id. */
export interface SubscriptionsLog {
  info(evt: string, fields: Fields): void;
  error(evt: string, fields: Fields): void;
}

/** A text value as a log line may carry it: edit link tokens taken out, phone numbers masked to their last two digits (AD-13). */
const clean = (text: string) => maskPhoneNumbers(redactEditTokens(text));

function write(level: "info" | "error", evt: string, fields: Fields): void {
  const safe = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === "string" ? clean(value) : value]));
  console.log(JSON.stringify({ level, evt: clean(evt), module: "subscriptions", ...safe }));
}

/** Structured JSON on stdout (spine: Logging), one line per event; whatever put a token or a number in a field, it never appears whole. */
export const stdoutSubscriptionsLog: SubscriptionsLog = {
  info: (evt, fields) => write("info", evt, fields),
  error: (evt, fields) => write("error", evt, fields),
};
