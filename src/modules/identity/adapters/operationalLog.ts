import type { OperationalLog } from "../application/ports";

/** Structured JSON on stdout (spine: Logging), one line per operational error or warning. */
export const stdoutOperationalLog: OperationalLog = {
  error(evt, fields) {
    console.log(JSON.stringify({ level: "error", evt, module: "identity", ...fields }));
  },
  warn(evt, fields) {
    console.log(JSON.stringify({ level: "warn", evt, module: "identity", ...fields }));
  },
};
