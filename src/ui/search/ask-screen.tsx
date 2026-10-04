"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { DirectoryManifestV1 } from "@/contracts/directory";
import { MAX_QUESTION_LENGTH } from "@/contracts/searchTestSet";
import { languageOf, type LaunchCode } from "@/i18n/languages";
import { CallHub } from "../directory/call-hub";
import { NO_FILTERS } from "../directory/filters";
import { saveFilters, tabStorage } from "../directory/filter-store";
import { ListingBlock } from "../directory/listing-text";
import { loadDirectory, type DirectoryState, type KeptStorage } from "../directory/load-directory";
import { ProviderView, type CategoryNames } from "../directory/provider-view";
import { Not911 } from "../emergency";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { withIsolated } from "../text/isolated";
import { ResidentText } from "../text/resident-text";
import { contentLangOf, resolveResults, type ResolvedResults } from "./resolve-results";
import { createRetryGate } from "./retry-gate";
import { askSearch } from "./search-client";
import "../directory/directory.css";
import "./search.css";

/** The phone's own storage, or null when it is blocked (a private window, cleared site data). */
function phoneStorage(): KeptStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * What the screen shows under the question box. Held in this component's state and nowhere else: the question itself is
 * in the box (and in `asked` while its results show) and is gone when the screen is.
 */
type Outcome =
  | { kind: "results"; resolved: Extract<ResolvedResults, { kind: "results" }>; asked: string; emergency: boolean }
  | { kind: "none"; emergency: boolean }
  | { kind: "signal" }
  | { kind: "busy" }
  | { kind: "updating" };

type Phase = { kind: "idle" } | { kind: "searching" } | { kind: "done"; outcome: Outcome };

/**
 * R-09, R-10 and R-11 (S03.06, FR-D2-Q, UX-DR10, AR-27, NFR-N2): the resident types a question and sees up to five
 * listings. The page reads the manifest and the listing file of its language like the directory does (load-directory.ts);
 * the box shows only when the manifest says search is available (or the manifest cannot be read, so that a question asked
 * without signal gets "Search needs signal" rather than nothing). The question goes to /api/search and nowhere else
 * (search-client.ts); the answer's ids are looked up in the listing file of that exact release (resolve-results.ts).
 * Nothing the server says is shown but the listings, the catalog's own words and the one 911 block.
 *
 * The question is never kept: not in storage, the address, the history or a log. The box has no `name`, so even a form
 * submitted before this page is ready (a browser without scripts) sends nothing and puts nothing in the address.
 */
export function AskScreen({ lang }: { lang: LaunchCode }) {
  const t = useTranslations();
  const router = useRouter();
  const [directory, setDirectory] = useState<DirectoryState>({ status: "loading" });
  // undefined: not known yet; null: the manifest could not be read.
  const [manifest, setManifest] = useState<DirectoryManifestV1 | null | undefined>(undefined);
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const inFlight = useRef<AbortController | null>(null);
  const retryGate = useRef(createRetryGate());
  // Where focus goes when an outcome is on screen (its heading), and when the box goes away (the topics' heading).
  const statusRef = useRef<HTMLDivElement>(null);
  const topicsRef = useRef<HTMLElement>(null);
  // The server said search is off ("unavailable"): the box is hidden for this visit and only the topics show.
  const [searchOff, setSearchOff] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let live = true;
    void loadDirectory(lang, {
      storage: phoneStorage(),
      onKept: (kept) => {
        if (live) setDirectory(kept);
      },
      onManifest: (read) => {
        if (live) {
          setManifest(read);
          setSearchOff(false);
        }
      },
    }).then((result) => {
      if (live) setDirectory(result);
    });
    return () => {
      live = false;
      inFlight.current?.abort();
    };
  }, [lang]);

  const listing = directory.status === "ready" ? directory.listing : null;
  const topics = useMemo(() => [...(listing?.categories ?? [])].sort((a, b) => a.sort_order - b.sort_order), [listing]);
  const searchAvailable = !searchOff && (manifest === undefined ? false : manifest === null || manifest.search.status === "available");
  const heldRelease = listing?.release_v;
  const searching = phase.kind === "searching";
  const asking = question.trim() !== "";

  const ask = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const q = question.trim();
      if (q === "" || phase.kind === "searching") return;
      // A client told to wait is not asked again until it may be: the server is not called.
      if (retryGate.current.closed()) {
        setPhase({ kind: "done", outcome: { kind: "busy" } });
        return;
      }
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setPhase({ kind: "searching" });
      let settled = false;
      const done = (outcome: Outcome) => {
        settled = true;
        if (!controller.signal.aborted) setPhase({ kind: "done", outcome });
      };

      try {
        const result = await askSearch({ q, lang, v: heldRelease }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        switch (result.kind) {
          case "offline":
            return done({ kind: "signal" });
          case "failed":
            return done({ kind: "busy" });
          case "busy":
            retryGate.current.waitFor(result.retryAfterSeconds);
            return done({ kind: "busy" });
          case "answer": {
            const { answer } = result;
            if (answer.status === "unavailable") {
              // Search is off: the box goes, the topics stay, and nothing says "busy" (the AC for an unavailable answer).
              settled = true;
              setSearchOff(true);
              setPhase({ kind: "idle" });
              return;
            }
            if (answer.status === "no_clear_match" || answer.results.length === 0) return done({ kind: "none", emergency: answer.emergency_first });
            const resolved = await resolveResults(answer, {
              lang,
              heldRelease,
              storage: phoneStorage(),
              // The manifest read again and the release it names become the screen's: the next question is sent with that `v`, and the topics are that release's.
              onRefreshed: ({ manifest: fresh, page }) => {
                if (controller.signal.aborted) return;
                setManifest(fresh);
                if (page) setDirectory({ status: "ready", ...page, current: true });
              },
            });
            if (resolved.kind === "updating") return done({ kind: "updating" });
            return done({ kind: "results", resolved, asked: q, emergency: answer.emergency_first });
          }
        }
      } catch {
        done({ kind: "busy" });
      } finally {
        // Whatever happened, the phase never stays "Searching" for a question nobody is waiting on any more.
        if (!settled && !controller.signal.aborted) setPhase({ kind: "done", outcome: { kind: "busy" } });
      }
    },
    [question, phase.kind, lang, heldRelease],
  );

  // Submitting, then reading the outcome: focus moves to its heading (the button that had it is still there, only inert).
  useEffect(() => {
    if (phase.kind === "done") statusRef.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [phase]);
  // The box went away under the resident's focus: the topics are what is left to read.
  useEffect(() => {
    if (searchOff) topicsRef.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [searchOff]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter asks; Shift+Enter and the composition of a keyboard (Urdu, Pashto, Chinese) keep their own meaning.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  /** A topic button: the directory with that topic applied. The filter is kept for the visit in the tab's storage, never in the address. */
  const openTopic = (id: string) => {
    saveFilters(tabStorage(), { ...NO_FILTERS, categories: [id] });
    router.push(`/${lang}/directory`);
  };

  const outcome = phase.kind === "done" ? phase.outcome : null;
  const x01 = (key: "text" | "call" | "short") => t(`x01.${key}`);
  const shown = languageOf((outcome?.kind === "results" ? outcome.resolved.shownLang : lang) as LaunchCode);
  const withHub = outcome !== null && outcome.kind !== "results";
  const resultTopics: CategoryNames | null = useMemo(() => (outcome?.kind === "results" ? new Map(outcome.resolved.listing.categories.map((c) => [c.id, c.name])) : null), [outcome]);

  return (
    <Screen surface="resident" testId="search-page">
      <Stack gap="section-resident">
        <Stack gap="related">
          <ResidentText as="h1">{t("R09.title")}</ResidentText>
          {searchAvailable && <ResidentText as="p" className="hide-basic">{t("R09.lead")}</ResidentText>}
        </Stack>

        {searchAvailable && (
          <form ref={formRef} className="ask-form" role="search" onSubmit={ask} data-testid="ask-form">
            <label className="ask-label" htmlFor="ask-q">
              <ResidentText>{t("R09.searchLabel")}</ResidentText>
            </label>
            <div className="ask-field">
              <textarea
                ref={inputRef}
                id="ask-q"
                className="ask-input"
                rows={2}
                maxLength={MAX_QUESTION_LENGTH}
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                dir="auto"
                placeholder={t("R09.prompt")}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={onKeyDown}
                data-testid="ask-input"
              />
              {asking && (
                <button
                  type="button"
                  className="ask-clear tap"
                  aria-label={t("R09.clear")}
                  onClick={() => {
                    setQuestion("");
                    inputRef.current?.focus();
                  }}
                  data-testid="ask-clear"
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </div>
            {/* aria-disabled, not disabled: a disabled button drops the focus the resident has just given it. Clicks are ignored while it is inert. */}
            <button
              type="submit"
              className="dir-btn dir-btn--primary tap"
              aria-disabled={!asking || searching}
              onClick={(event) => {
                if (!asking || searching) event.preventDefault();
              }}
              data-testid="ask-submit"
            >
              <ResidentText>{t("R09.search")}</ResidentText>
            </button>
          </form>
        )}

        {/* The live region: always in the page, so that what is put into it is announced. */}
        <div ref={statusRef} className="ask-status" role="status" aria-live="polite" data-testid="ask-status">
          {searching && (
            <ResidentText as="p" testId="ask-searching">
              {t("R09.searching")}
            </ResidentText>
          )}
          {outcome?.kind === "results" && (
            <h2 tabIndex={-1} className="ask-status__title" data-testid="ask-results-title">
              {outcome.resolved.providers.length === 1
                ? withIsolated((q) => t("R10.resultsForOne", { q }), outcome.asked, "auto")
                : withIsolated((q) => t("R10.resultsFor", { n: outcome.resolved.providers.length, q }), outcome.asked, "auto")}
            </h2>
          )}
          {outcome?.kind === "none" && (
            <ResidentText as="h2" className="ask-status__title" testId="ask-none-title" tabIndex={-1}>
              {t("R11.title")}
            </ResidentText>
          )}
          {outcome?.kind === "signal" && (
            <ResidentText as="h2" className="ask-status__title" testId="ask-signal-title" tabIndex={-1}>
              {t("R09.needsSignal")}
            </ResidentText>
          )}
          {outcome?.kind === "busy" && (
            <ResidentText as="h2" className="ask-status__title" testId="ask-busy-title" tabIndex={-1}>
              {t("R09.busy")}
            </ResidentText>
          )}
          {outcome?.kind === "updating" && (
            <ResidentText as="h2" className="ask-status__title" testId="ask-updating-title" tabIndex={-1}>
              {t("R09.updating")}
            </ResidentText>
          )}
        </div>

        {outcome && "emergency" in outcome && outcome.emergency && (
          <div data-testid="ask-emergency-first">
            <Not911 t={x01} />
          </div>
        )}

        {outcome?.kind === "results" && (
          <Stack gap="related">
            {outcome.resolved.note && (
              <div className="dir-note" role="note" data-testid="ask-shown-in">
                <p>{withIsolated((name) => t("R10.shownIn", { lang: name }), shown.native, { lang: shown.bcp47, dir: shown.dir })}</p>
              </div>
            )}
            <ul className="dir-list" data-testid="ask-results">
              {outcome.resolved.providers.map((provider) => (
                <li key={provider.id}>
                  <ProviderView
                    provider={provider}
                    categories={resultTopics ?? new Map()}
                    lang={lang}
                    variant="card"
                    contentLang={contentLangOf(outcome.resolved.shownLang, lang)}
                  />
                </li>
              ))}
            </ul>
          </Stack>
        )}

        {withHub && (
          <section className="dir-empty" data-testid="ask-help" aria-label={t("R11.person")}>
            <Stack gap="related">
              {outcome.kind === "none" && <ResidentText as="p">{t("R11.body")}</ResidentText>}
              {outcome.kind === "signal" && <ResidentText as="p">{t("R09.needsSignalBody")}</ResidentText>}
              {outcome.kind === "busy" && <ResidentText as="p">{t("R09.busyBody")}</ResidentText>}
              {outcome.kind === "updating" && <ResidentText as="p">{t("R09.updatingBody")}</ResidentText>}
              <ResidentText as="p" className="dir-strong">
                {t("R11.person")}
              </ResidentText>
              <CallHub testId="hub-call" />
            </Stack>
          </section>
        )}

        <section ref={topicsRef} className="ask-topics-section" aria-labelledby="ask-topics-title" data-testid="ask-topics-section">
          <Stack gap="related">
            <ResidentText as="h2" testId="ask-topics-title" tabIndex={-1}>
              {outcome?.kind === "none" ? t("R11.categories") : t("R09.orChoose")}
            </ResidentText>
            {directory.status === "loading" && <ResidentText as="p">{t("R09.loading")}</ResidentText>}
            {topics.length > 0 && (
              <ul className="ask-topics" data-testid="ask-topics">
                {topics.map((topic) => (
                  <li key={topic.id}>
                    <button type="button" className="ask-topic tap" onClick={() => openTopic(topic.id)} data-testid={`ask-topic-${topic.id}`}>
                      <ListingBlock text={topic.name} as="span" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {directory.status !== "loading" && (
              <Link className="dir-link tap" href={`/${lang}/directory`} prefetch={false} data-testid="ask-browse-all">
                <ResidentText>{t("R09.browseAll")}</ResidentText>
              </Link>
            )}
          </Stack>
        </section>

        {/* R-09 and R-11 end with the shared inline 911 note (prototype X01_Not911, inline) and the way to dial it. */}
        <Stack gap="related">
          <Not911 variant="inline" t={x01} />
          <p className="ask-911">
            <a className="dir-link tap" href="tel:911" data-testid="ask-911-link">
              <ResidentText>{t("x01.call")}</ResidentText>
            </a>
          </p>
        </Stack>
      </Stack>
    </Screen>
  );
}
