import type { SpendLog } from "../application/smsReconciler";

type Fields = Record<string, string | number | boolean | null>;

function write(level: "info" | "error", evt: string, fields: Fields): void {
  console.log(JSON.stringify({ level, evt, module: "spend", ...fields }));
}

/** Structured JSON on stdout (spine: Logging), one line per event. The spend module's events hold ids, counts and codes only. */
export const stdoutSpendLog: SpendLog = {
  info: (evt, fields) => write("info", evt, fields),
  error: (evt, fields) => write("error", evt, fields),
};
