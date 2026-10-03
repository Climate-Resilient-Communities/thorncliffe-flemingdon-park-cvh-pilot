// What the browser does, call by call, when Submit (or "Try translation again") is pressed (S04.05), as a function of its seams so that it is
// tested without a browser: the composer gives it the draft's save, the submit endpoints and a place to send the machine's events
// (submitMachine.ts decides what each of them means).
//
//   1. If an earlier press left a key whose outcome the server never confirmed, ask the server what became of it: the request may have got
//      through after the connection was lost. A key it knows is followed (running, committed or failed), never replaced.
//   2. A submit saves the draft the form holds, so what is frozen is what the author sees. If that save is refused and an earlier key is
//      unconfirmed, ask again first: the earlier request may have frozen the entry in between, which is why it is no longer a draft.
//   3. Send the request with the earlier unconfirmed key if there is one (the server returns the first attempt's result for a key it has
//      seen and runs the press for one it has not), else with a new key. The key is new only when the outcome of the last is known.
import type { ComposeState } from "./editDraft";
import type { SubmitApi } from "./submitClient";
import type { SubmitEvent, SubmitKind, Unconfirmed } from "./submitMachine";

export interface PressDeps {
  alertId: string;
  entryId: string;
  api: SubmitApi;
  /** The first half of a submit: saves the draft the form holds now. */
  save: () => Promise<ComposeState>;
  /** What the form shows when the save could not even be made (the call threw). */
  saveFailed: ComposeState;
  /** Shows a save's answer in the form: a refusal, a question about the clock change, or nothing (idle) once it saved. */
  showSave: (state: ComposeState) => void;
  /** The pending version and hash the person is looking at, for "Try translation again". */
  seen: () => { version: number; hash: string };
  dispatch: (event: SubmitEvent) => void;
  newKey: () => string;
  /** Monotonic milliseconds. */
  now: () => number;
}

export async function press(deps: PressDeps, earlier: Unconfirmed | null, kind: SubmitKind): Promise<void> {
  const { alertId, entryId, api, dispatch } = deps;
  const reuse = earlier !== null && earlier.kind === kind ? earlier : null;
  dispatch({ type: "saving" });

  /** Whether the server already knows the earlier key; the screen then goes by what it says. */
  const known = async (): Promise<boolean> => {
    if (reuse === null) return false;
    const state = await api.state(alertId, entryId).catch(() => null);
    if (state?.attempt?.key !== reuse.key) return false;
    dispatch({ type: "known", key: reuse.key, kind, state, at: deps.now() });
    return true;
  };
  if (await known()) return;

  let draft: string | undefined;
  if (kind === "submit") {
    const saved = await deps.save().catch((): ComposeState => deps.saveFailed);
    if (saved.status !== "saved") {
      if (await known()) return;
      deps.showSave(saved);
      dispatch({ type: "save_stopped" });
      return;
    }
    deps.showSave({ status: "idle" });
    draft = saved.fingerprint;
  }

  const key = reuse?.key ?? deps.newKey();
  dispatch({ type: "sent", key, kind });
  try {
    const request = { v: 1 as const, alert_id: alertId, entry_id: entryId, key };
    const result =
      kind === "submit"
        ? await api.submit(draft === undefined ? request : { ...request, draft })
        : await api.retranslate({ ...request, seen_version: deps.seen().version, seen_hash: deps.seen().hash });
    dispatch({ type: "answered", result, at: deps.now() });
  } catch {
    // The answer was not seen: the screen says so and goes by the entry's own state. The key stays, unconfirmed, for the next press.
    dispatch({ type: "lost", at: deps.now() });
  }
}
