import type { MessagingLog } from "../application/deliveryPorts";
import { maskPhoneNumbers } from "../domain/phoneNumber";

type Fields = Record<string, string | number | boolean | null>;

/** Every text value with its phone-number-like parts masked to their last two digits (AD-13), whatever put them there. */
function masked(fields: Fields): Fields {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === "string" ? maskPhoneNumbers(value) : value]));
}

function write(level: "info" | "error", evt: string, fields: Fields): void {
  console.log(JSON.stringify({ level, evt, module: "messaging", ...masked(fields) }));
}

/** Structured JSON on stdout (spine: Logging), one line per event; numbers never appear whole. */
export const stdoutMessagingLog: MessagingLog = {
  info: (evt, fields) => write("info", evt, fields),
  error: (evt, fields) => write("error", evt, fields),
};
