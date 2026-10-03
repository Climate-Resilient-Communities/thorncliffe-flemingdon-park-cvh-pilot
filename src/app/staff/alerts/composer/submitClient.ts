// The composer's calls to the submit endpoints (S04.05, src/contracts/alertSubmit.ts): the browser's side of the wire. Every body is
// checked with the contract's schema on the way back, so a body the screen does not understand is an error (the answer was not seen) and
// not a guess. `fetch` is a parameter so that the tests, and a layout fixture, need no server.
import {
  EntryStateSchema,
  SubmitResultSchema,
  type EntryState,
  type RetranslateRequest,
  type SubmitRequest,
  type SubmitResult,
} from "@/contracts/alertSubmit";

export const SUBMIT_URL = "/api/staff/alerts/entries/submit";
export const RETRANSLATE_URL = "/api/staff/alerts/entries/retranslate";
export const STATE_URL = "/api/staff/alerts/entries/state";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SubmitApi {
  submit(request: SubmitRequest): Promise<SubmitResult>;
  retranslate(request: RetranslateRequest): Promise<SubmitResult>;
  state(alertId: string, entryId: string): Promise<EntryState | null>;
}

/** A body that is not what the contract says, or a status that is not a 200: the outcome of this call was not seen. */
export class SubmitCallError extends Error {
  override name = "SubmitCallError";
}

async function post(fetcher: Fetch, url: string, body: unknown): Promise<SubmitResult> {
  const response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (!response.ok) throw new SubmitCallError(`status ${response.status}`);
  const parsed = SubmitResultSchema.safeParse(await response.json());
  if (!parsed.success) throw new SubmitCallError("unreadable answer");
  return parsed.data;
}

export function submitApi(fetcher: Fetch = (input, init) => fetch(input, init)): SubmitApi {
  return {
    submit: (request) => post(fetcher, SUBMIT_URL, request),
    retranslate: (request) => post(fetcher, RETRANSLATE_URL, request),
    async state(alertId, entryId) {
      const response = await fetcher(`${STATE_URL}?${new URLSearchParams({ alert: alertId, entry: entryId }).toString()}`, { cache: "no-store" });
      if (!response.ok) return null;
      const parsed = EntryStateSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : null;
    },
  };
}
