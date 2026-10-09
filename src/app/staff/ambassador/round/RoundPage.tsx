"use client";

// "My round" (A-04, S08.07) as it is drawn and tapped: one column for a phone, used with one hand. Every text comes from the screen (view.ts); the round and
// the marks waiting to be sent are held by the model (roundModel.ts) in this page's memory only. The page listens for the background (`visibilitychange`,
// `pagehide`, `pageshow`) and hands each event to the model inside `flushSync`, so a round cleared after 10 minutes in the background is gone from the
// screen before the browser draws it again. What a mark was answered is said on its row, or above the round when the row is not shown (a waiting mark
// refused after the round was cleared). Nothing is written to the phone's storage.
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MARK_STATUSES, type RoundCounts, type RoundThreadView } from "@/contracts/checkinRound";
import { displayPhone } from "@/contracts/phone";
import { Grid, Stack } from "@/ui";
import { createRoundModel, type RoundEnv, type RoundModel, type RoundState, type RowNote } from "./roundModel";
import { contactHref, fill, type RoundScreen } from "./view";

/** The browser's seams for the model: the network, the `online` event, a timer, the id maker and the clock; never any storage. */
function browserEnv(): RoundEnv {
  return {
    fetch: (url, init) => fetch(url, { ...init, credentials: "same-origin", cache: "no-store" }),
    isOnline: () => navigator.onLine,
    onOnline: (listener) => {
      window.addEventListener("online", listener);
      return () => window.removeEventListener("online", listener);
    },
    later: (run, ms) => {
      const timer = window.setTimeout(run, ms);
      return () => window.clearTimeout(timer);
    },
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
  };
}

/** A thread's counts, from its requests' latest marks and its counted floors. */
function tallyOf(thread: RoundThreadView): RoundCounts {
  const counts: RoundCounts = { pending: 0, done: 0, not_reached: 0, needs_help: 0 };
  for (const building of thread.buildings) {
    for (const floor of building.floors) {
      if (floor.kind === "counts") for (const status of ["pending", "done", "not_reached", "needs_help"] as const) counts[status] += floor.counts[status];
      else for (const request of floor.requests) counts[request.status] += 1;
    }
  }
  return counts;
}

/** The `round_ref`s of the requests the page shows now (none unless the round is held). */
function shownRefs(state: RoundState): Set<string> {
  const refs = new Set<string>();
  if (state.phase !== "ready" || state.round === null) return refs;
  for (const thread of state.round.rounds) {
    for (const building of thread.buildings) for (const floor of building.floors) if (floor.kind === "contacts") for (const request of floor.requests) refs.add(request.round_ref);
  }
  return refs;
}

/** What a mark was answered: "This round has ended..." with the Hub's number as a `tel:` link, or the note's own words. */
function NoteText({ screen, note }: { screen: RoundScreen; note: RowNote }) {
  if (note !== "round_ended") return <>{screen.notes[note]}</>;
  return (
    <>
      {screen.roundEnded.before}
      <a className="hub-link" href={screen.hub.href}>
        {screen.hub.label}
      </a>
      {screen.roundEnded.after}
    </>
  );
}

const tallyLine = (screen: RoundScreen, counts: RoundCounts) => fill(screen.tally, { todo: counts.pending, done: counts.done, nr: counts.not_reached, help: counts.needs_help });

const initialState = (initial: Partial<RoundState> | undefined): RoundState => ({
  phase: initial?.phase ?? "loading",
  round: initial?.round ?? null,
  waiting: initial?.waiting ?? [],
  online: initial?.online ?? true,
  notes: initial?.notes ?? {},
});

export function RoundPage({ screen, initial, env }: { screen: RoundScreen; initial?: Partial<RoundState>; env?: () => RoundEnv }) {
  const [state, setState] = useState<RoundState>(() => initialState(initial));
  const modelRef = useRef<RoundModel | null>(null);

  useEffect(() => {
    const model = createRoundModel((env ?? browserEnv)(), setState, initial);
    modelRef.current = model;
    // Before anything is drawn again: the time spent in the background is compared with now (never a timer, which browsers suspend).
    const onVisibility = () => flushSync(() => (document.visibilityState === "hidden" ? model.hidden() : model.visible()));
    const onPagehide = () => flushSync(() => model.pagehide());
    const onPageshow = (event: PageTransitionEvent) => flushSync(() => model.pageshow(event.persisted));
    const onOnline = () => model.signal(true);
    const onOffline = () => model.signal(false);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPagehide);
    window.addEventListener("pageshow", onPageshow);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (initial?.phase === undefined) model.load();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPagehide);
      window.removeEventListener("pageshow", onPageshow);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      model.stop();
    };
    // The model is made once, for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marks that have not reached the Hub are lost with the page: the browser asks before the page is left.
  const waiting = state.waiting.length > 0;
  useEffect(() => {
    if (!waiting) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [waiting]);

  const queued = new Set(state.waiting.map((mark) => mark.roundRef));
  // The answer to a mark whose row is not on the screen (the round was cleared, or read again without it) is said above the round, once per kind.
  const shown = shownRefs(state);
  const loose = [...new Set(Object.entries(state.notes).flatMap(([roundRef, note]) => (shown.has(roundRef) ? [] : [note])))];
  const reload = (
    <p>
      <button type="button" className="hub-button hub-button--primary" onClick={() => modelRef.current?.load()} data-testid="round-reload">
        {screen.reloadButton}
      </button>
    </p>
  );

  return (
    <Stack gap="section-hub-main">
      <Stack gap="related">
        <h1 className="hub-wrap">{screen.title}</h1>
        <p className="hub-wrap">{screen.lead}</p>
        {!state.online && (
          <p role="status" className="hub-flag hub-wrap" data-testid="round-offline">
            {screen.offline}
          </p>
        )}
        {waiting && (
          <p role="status" className="hub-flag hub-wrap" data-testid="round-waiting">
            <span className="hub-flag__label">{state.waiting.length === 1 ? screen.waitingOne : fill(screen.waitingMany, { n: state.waiting.length })}</span> {screen.keepOpen}
          </p>
        )}
        {loose.map((note) => (
          <p key={note} role="status" className="hub-flag hub-wrap" data-testid="round-note-loose" data-tap-exempt="inline-text">
            <NoteText screen={screen} note={note} />
          </p>
        ))}
      </Stack>

      {state.phase === "loading" && (
        <p role="status" data-testid="round-loading">
          {screen.loading}
        </p>
      )}
      {state.phase === "cleared" && (
        <Stack gap="related" testId="round-cleared">
          <p role="status" className="hub-flag hub-wrap">
            {screen.reload}
          </p>
          {reload}
        </Stack>
      )}
      {state.phase === "signed_out" && (
        <p role="alert" className="hub-error hub-wrap" data-testid="round-signed-out">
          {screen.signedOut}
        </p>
      )}
      {state.phase === "failed" && (
        <Stack gap="related">
          <p role="alert" className="hub-error hub-wrap" data-testid="round-failed">
            {screen.loadFailed}
          </p>
          {reload}
        </Stack>
      )}
      {state.phase === "ready" && state.round !== null && state.round.rounds.length === 0 && (
        <p className="hub-wrap" data-testid="round-none">
          {screen.noRound}
        </p>
      )}

      {state.phase === "ready" &&
        state.round !== null &&
        state.round.rounds.map((thread, threadIndex) => (
          <section key={threadIndex} aria-labelledby={`round-${threadIndex}`} data-testid="round-thread">
            <Stack gap="related">
              <h2 id={`round-${threadIndex}`} className="hub-wrap hub-preline">
                {fill(screen.forAlert, { headline: thread.headline })}
              </h2>
              <p role="status" className="hub-wrap" data-testid="round-tally">
                {tallyLine(screen, tallyOf(thread))}
              </p>
              {thread.buildings.map((building) => (
                <Stack key={building.address} gap="related">
                  <h3 className="hub-wrap">{building.address}</h3>
                  {building.floors.map((floor) => (
                    <Stack key={floor.label} gap="related" testId={floor.kind === "counts" ? "round-floor-counts" : "round-floor"}>
                      <h4 className="hub-wrap">
                        <strong>{fill(screen.floor, { n: floor.label })}</strong>
                      </h4>
                      {floor.kind === "counts" ? (
                        <>
                          <p className="hub-wrap">{tallyLine(screen, floor.counts)}</p>
                          {screen.countsNote !== null && <p className="hub-wrap">{screen.countsNote}</p>}
                        </>
                      ) : (
                        <Stack as="ul" gap="related">
                          {floor.requests.map((request) => {
                            const number = displayPhone(request.phone);
                            const note = state.notes[request.round_ref];
                            return (
                              <li key={request.round_ref} className="hub-list-item" data-testid="round-request" data-round-ref={request.round_ref}>
                                <Stack gap="label">
                                  <p className="hub-wrap">
                                    <a className="tap hub-link" href={contactHref(request.method, request.phone)} data-testid="round-contact">
                                      {fill(request.method === "call" ? screen.call : screen.text, { phone: number })}
                                    </a>
                                  </p>
                                  {request.language !== undefined && (
                                    <p className="hub-wrap" data-testid="round-language">
                                      {fill(screen.language, { language: request.language })}
                                    </p>
                                  )}
                                  {request.status !== "pending" && (
                                    <p className="hub-wrap" data-testid="round-marked">
                                      {fill(screen.marked, { mark: screen.marks[request.status] })}
                                    </p>
                                  )}
                                  {queued.has(request.round_ref) && (
                                    <p className="hub-wrap" data-testid="round-not-sent">
                                      {screen.notSent}
                                    </p>
                                  )}
                                  {note !== undefined && (
                                    <p role="status" className="hub-flag hub-wrap" data-testid="round-note" data-tap-exempt="inline-text">
                                      <NoteText screen={screen} note={note} />
                                    </p>
                                  )}
                                  <div role="group" aria-label={fill(screen.marksFor, { phone: number })}>
                                    <Grid cols={3} gap="target" collapseInBasic={false}>
                                      {MARK_STATUSES.map((status) => (
                                        <button
                                          key={status}
                                          type="button"
                                          className={`hub-button ${request.status === status ? "hub-button--primary" : "hub-button--secondary"}`}
                                          aria-pressed={request.status === status}
                                          onClick={() => modelRef.current?.mark(request.round_ref, status)}
                                          data-testid={`round-mark-${status}`}
                                        >
                                          {screen.marks[status]}
                                        </button>
                                      ))}
                                    </Grid>
                                  </div>
                                </Stack>
                              </li>
                            );
                          })}
                        </Stack>
                      )}
                    </Stack>
                  ))}
                </Stack>
              ))}
            </Stack>
          </section>
        ))}

      {state.phase === "ready" && state.round !== null && state.round.rounds.length > 0 && <p className="hub-wrap">{screen.deleted}</p>}
      <p>
        <a className="tap hub-link" href={screen.home.href}>
          {screen.home.label}
        </a>
      </p>
    </Stack>
  );
}
