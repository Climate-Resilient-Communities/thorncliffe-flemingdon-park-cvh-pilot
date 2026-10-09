"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DirectoryListingV1, ListingText, NeighbourhoodId } from "@/contracts/directory";
import type { LaunchCode } from "@/i18n/languages";
import { languageOf } from "@/i18n/languages";
import { useBuildingList, useChoices } from "../choices/use-choices";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { Isolated, withIsolated } from "../text/isolated";
import { singleNeighbourhood } from "../usage/nbhd";
import { UsageView } from "../usage/usage";
import { isEnglishFallbackMessage, ResidentText } from "../text/resident-text";
import { CallHub } from "./call-hub";
import { readFilters, saveFilters, tabStorage, withoutUnknownTopics } from "./filter-store";
import { activeKeys, filterKeyId, filterProviders, isActive, listProviders, NO_FILTERS, setFilter, type FilterKey, type FilterState } from "./filters";
import { formatMoment } from "./format";
import { Inline911, isFallbackText, ListingBlock, UnavailableNote } from "./listing-text";
import { isNeighbourhoodId, NEIGHBOURHOODS, neighbourhoodName } from "./neighbourhood-names";
import { NumbersLink } from "./numbers-link";
import { ProviderView, type CategoryNames } from "./provider-view";
import { useDirectory } from "./use-directory";
import "./directory.css";

/** True when any text the directory shows in this language is English standing in for a missing translation. */
export function hasFallbackText(listing: DirectoryListingV1): boolean {
  const texts: ListingText[] = [
    ...listing.categories.map((c) => c.name),
    ...listing.providers.flatMap((p) => [p.services, ...(p.emergency_role ? [p.emergency_role] : []), ...p.subcategories]),
  ];
  return texts.some(isFallbackText);
}

/** The neighbourhoods of the buildings this resident chose, once the building list has told which they are; null while that is not known. */
function useChosenNeighbourhoods(): NeighbourhoodId[] | null {
  const choices = useChoices();
  const chosen = choices?.buildings ?? [];
  const wanted = chosen.length > 0;
  const { state } = useBuildingList(wanted);
  if (choices === undefined) return null;
  if (!wanted) return [];
  if (state.status === "loading") return null;
  if (state.status === "failed") return [];
  const ids = state.list.buildings.filter((b) => chosen.includes(b.rsn)).map((b) => b.neighbourhoodId);
  return [...new Set(ids)].filter(isNeighbourhoodId);
}

function FilterOption({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className="dir-option tap" data-testid={`filter-${id}`}>
      <input className="dir-option__input" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="dir-option__text">{children}</span>
    </label>
  );
}

/** Where focus goes after a control that disappears is used: the next chip's remove button, "Clear all", or the filters button. */
type FocusTarget = { chip: string } | "clear-all" | "toggle";

/**
 * The directory (R-10 as the pilot has it, UX-DR10): every published provider of the current release in the page
 * language, each once, narrowed on the phone by topic, neighbourhood and "Helps in an emergency" (R-27), with the applied
 * filters above the list (X-11) and, when nothing matches, a way to reach a person at the Hub (R-11). The list comes from
 * the downloaded release file (use-directory.ts). The filters are kept for the visit in sessionStorage, so opening a
 * provider and going back keeps them (filter-store.ts); they are never in the address and never sent. The neighbourhood of
 * the buildings the resident chose is only suggested, as a chip they tap to apply.
 */
export function DirectoryBrowser({ lang }: { lang: LaunchCode }) {
  const t = useTranslations();
  const directory = useDirectory(lang);
  const [applied, setApplied] = useState<FilterState>(() => readFilters(tabStorage()));
  // The neighbourhood this visit began with, for the usage count (S02.15): the one filter in force when the page opened, if it names one place.
  const [viewed] = useState(() => singleNeighbourhood(applied.neighbourhoods));
  const [panelOpen, setPanelOpen] = useState(false);
  const chosen = useChosenNeighbourhoods();
  const toggleButton = useRef<HTMLButtonElement>(null);
  const clearAllButton = useRef<HTMLButtonElement>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfter = useRef<FocusTarget | null>(null);

  const listing = directory.status === "ready" ? directory.listing : null;
  // A kept filter whose topic the release no longer has does not count.
  const filters = useMemo(() => (listing ? withoutUnknownTopics(applied, listing.categories.map((c) => c.id)) : applied), [applied, listing]);
  const categories: CategoryNames = useMemo(() => new Map((listing?.categories ?? []).map((c) => [c.id, c.name])), [listing]);
  const ordered = useMemo(() => (listing ? listProviders(listing.providers, languageOf(lang).bcp47) : []), [listing, lang]);
  const visible = useMemo(() => filterProviders(ordered, filters), [ordered, filters]);
  const topics = useMemo(() => [...(listing?.categories ?? [])].sort((a, b) => a.sort_order - b.sort_order), [listing]);

  // The filters survive the next page of the visit.
  useEffect(() => {
    saveFilters(tabStorage(), filters);
  }, [filters]);

  // A control that was used and is gone leaves focus nowhere: it goes to the control that takes its place.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    const element = target === "toggle" ? toggleButton.current : target === "clear-all" ? clearAllButton.current : removeButtons.current.get(target.chip);
    (element ?? toggleButton.current)?.focus();
  });

  const toggle = (key: FilterKey, on: boolean) => setApplied((current) => setFilter(current, key, on));
  const clearAll = (focus: boolean) => {
    if (focus) focusAfter.current = "toggle";
    setApplied(NO_FILTERS);
  };
  /** The chip's own remove control: focus moves to the next chip, or to "Clear all" when it was the last. */
  const removeChip = (key: FilterKey, keys: readonly FilterKey[]) => {
    const at = keys.findIndex((other) => filterKeyId(other) === filterKeyId(key));
    const next = keys[at + 1];
    focusAfter.current = next ? { chip: filterKeyId(next) } : keys.length > 1 ? "clear-all" : "toggle";
    toggle(key, false);
  };
  const closePanel = () => {
    setPanelOpen(false);
    toggleButton.current?.focus();
  };

  const keys = activeKeys(filters);
  const hidden = ordered.length - visible.length;
  const suggestions = (chosen ?? []).filter((id) => !filters.neighbourhoods.includes(id));
  const labelOf = (key: FilterKey): ReactNode => {
    switch (key.kind) {
      case "category": {
        const name = categories.get(key.id);
        return name ? <ListingBlock text={name} as="span" /> : key.id;
      }
      case "neighbourhood":
        return <Isolated>{neighbourhoodName(key.id)}</Isolated>;
      case "emergency":
        return <ResidentText>{t("directory.emergency")}</ResidentText>;
    }
  };
  /** The same chip as a plain string, for the remove button's name. */
  const nameOf = (key: FilterKey): string => {
    switch (key.kind) {
      case "category":
        return categories.get(key.id)?.body ?? key.id;
      case "neighbourhood":
        return neighbourhoodName(key.id);
      case "emergency":
        return t("directory.emergency");
    }
  };

  const applyLabel = visible.length === 0 ? t("R27.applyNone") : visible.length === 1 ? t("R27.applyOne") : t("R27.apply", { n: visible.length });
  const countLabel = visible.length === 1 ? t("directory.countOne") : t("directory.count", { n: visible.length });
  const locale = languageOf(lang).bcp47;

  return (
    <Screen surface="resident" testId="directory-page">
      <UsageView evt="directory_view" lang={lang} nbhd={viewed} />
      <Stack gap="section-resident">
        <Stack gap="related">
          <ResidentText as="h1">{t("directory.title")}</ResidentText>
          {directory.status !== "unavailable" && <ResidentText as="p">{t("directory.lead")}</ResidentText>}
          {directory.status === "ready" && !directory.current && (
            <ResidentText as="p" className="dir-updated" testId="directory-last-updated">
              {t("directory.lastUpdated", { time: formatMoment(directory.publishedAt, isEnglishFallbackMessage(t, "directory.lastUpdated") ? "en-CA" : locale) })}
            </ResidentText>
          )}
          {listing && lang !== "en" && hasFallbackText(listing) && <UnavailableNote lang={lang} />}
        </Stack>

        {directory.status === "loading" && (
          <ResidentText as="p" testId="directory-loading">
            {t("directory.loading")}
          </ResidentText>
        )}

        {directory.status === "unavailable" && (
          <section className="dir-empty" data-testid="directory-unavailable" aria-labelledby="dir-unavailable-title">
            <Stack gap="related">
              <ResidentText as="h2" testId="dir-unavailable-title">
                {t("directory.couldNotLoad")}
              </ResidentText>
              <ResidentText as="p">{t("directory.couldNotLoadBody")}</ResidentText>
              <CallHub testId="hub-call" />
              <NumbersLink lang={lang} />
            </Stack>
          </section>
        )}

        {listing && (
          <div className="dir-workspace" data-layout="columns" data-testid="directory-workspace">
            <Stack gap="related">
              <section className="dir-filters" aria-label={t("R27.title")} data-testid="filters">
                <Stack gap="related">
                  <button
                    ref={toggleButton}
                    type="button"
                    className="dir-btn dir-btn--secondary tap"
                    aria-expanded={panelOpen}
                    aria-controls="dir-filter-panel"
                    onClick={() => setPanelOpen((open) => !open)}
                    data-testid="filters-toggle"
                  >
                    <ResidentText>{keys.length > 0 ? t("R10.filtersCount", { n: keys.length }) : t("R10.filters")}</ResidentText>
                  </button>
                  {suggestions.length > 0 && (
                    <div className="dir-suggest" data-testid="filter-suggestions">
                      <ResidentText as="p" className="dir-hint">
                        {t("R27.fromChoices")}
                      </ResidentText>
                      <ul className="dir-suggest__list">
                        {suggestions.map((id) => (
                          <li key={id}>
                            <button type="button" className="dir-suggest__chip tap" onClick={() => toggle({ kind: "neighbourhood", id }, true)} data-testid={`suggest-neighbourhood-${id}`}>
                              <span aria-hidden="true">+</span>
                              <span>{withIsolated((place) => t("directory.suggestApply", { place }), neighbourhoodName(id))}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div id="dir-filter-panel" data-open={panelOpen} data-testid="filter-panel">
                    <Stack gap="stack">
                      <ResidentText as="p" className="dir-hint">
                        {t("R27.private")}
                      </ResidentText>
                      <fieldset className="dir-fieldset">
                        <ResidentText as="legend" className="dir-legend" testId="legend-topic">
                          {t("directory.topic")}
                        </ResidentText>
                        <Stack gap="label">
                          {topics.map((category) => (
                            <FilterOption
                              key={category.id}
                              id={`category-${category.id}`}
                              checked={isActive(filters, { kind: "category", id: category.id })}
                              onChange={(on) => toggle({ kind: "category", id: category.id }, on)}
                            >
                              <ListingBlock text={category.name} as="span" />
                            </FilterOption>
                          ))}
                        </Stack>
                      </fieldset>
                      <fieldset className="dir-fieldset">
                        <ResidentText as="legend" className="dir-legend" testId="legend-neighbourhood">
                          {t("filters.nbhd")}
                        </ResidentText>
                        <Stack gap="label">
                          {NEIGHBOURHOODS.map(({ id, name }) => (
                            <FilterOption key={id} id={`neighbourhood-${id}`} checked={isActive(filters, { kind: "neighbourhood", id })} onChange={(on) => toggle({ kind: "neighbourhood", id }, on)}>
                              <Isolated>{name}</Isolated>
                            </FilterOption>
                          ))}
                        </Stack>
                      </fieldset>
                      <FilterOption id="emergency" checked={filters.emergency} onChange={(on) => toggle({ kind: "emergency" }, on)}>
                        <ResidentText>{t("directory.emergency")}</ResidentText>
                      </FilterOption>
                      <div className="dir-actions">
                        <button type="button" className="dir-btn dir-btn--primary tap" onClick={closePanel} data-testid="filters-apply">
                          <ResidentText>{applyLabel}</ResidentText>
                        </button>
                        <button type="button" className="dir-btn dir-btn--secondary tap" onClick={() => clearAll(false)} data-testid="filters-clear">
                          <ResidentText>{t("R27.clear")}</ResidentText>
                        </button>
                      </div>
                    </Stack>
                  </div>
                </Stack>
              </section>

              {keys.length > 0 && (
                <div className="dir-bar" role="region" aria-label={t("x11.title")} data-testid="filter-bar">
                  <ResidentText as="p" className="dir-bar__title">
                    {t("x11.title")}
                  </ResidentText>
                  <ul className="dir-bar__chips">
                    {keys.map((key) => (
                      <li className="dir-chip" key={filterKeyId(key)} data-testid={`chip-${filterKeyId(key)}`}>
                        <span className="dir-chip__label">{labelOf(key)}</span>
                        <button
                          ref={(element) => {
                            if (element) removeButtons.current.set(filterKeyId(key), element);
                            else removeButtons.current.delete(filterKeyId(key));
                          }}
                          type="button"
                          className="dir-chip__x tap"
                          aria-label={t("x11.remove", { f: nameOf(key) })}
                          onClick={() => removeChip(key, keys)}
                          data-testid={`remove-${filterKeyId(key)}`}
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {hidden > 0 && (
                    <ResidentText as="p" className="dir-bar__count" testId="hidden-count">
                      {hidden === 1 ? t("x11.hidingOne") : t("x11.hiding", { n: hidden })}
                    </ResidentText>
                  )}
                  <button ref={clearAllButton} type="button" className="dir-btn dir-btn--quiet tap" onClick={() => clearAll(true)} data-testid="clear-all">
                    <ResidentText>{t("R27.clear")}</ResidentText>
                  </button>
                </div>
              )}
            </Stack>

            {visible.length > 0 ? (
              <Stack gap="related">
                <ResidentText as="p" className="dir-count" testId="directory-count">
                  {countLabel}
                </ResidentText>
                <ul className="dir-list" data-testid="directory-list">
                  {visible.map((provider) => (
                    <li key={provider.id}>
                      <ProviderView provider={provider} categories={categories} lang={lang} variant="card" />
                    </li>
                  ))}
                </ul>
              </Stack>
            ) : (
              <section className="dir-empty" data-testid="directory-empty" aria-labelledby="dir-empty-title">
                <Stack gap="related">
                  <ResidentText as="h2" testId="dir-empty-title">
                    {t("R11.title")}
                  </ResidentText>
                  <ResidentText as="p">{t("R11.body")}</ResidentText>
                  <ResidentText as="p" className="dir-strong">
                    {t("R11.person")}
                  </ResidentText>
                  <CallHub testId="hub-call" />
                  {keys.length > 0 && (
                    <button type="button" className="dir-btn dir-btn--secondary tap" onClick={() => clearAll(true)} data-testid="empty-clear">
                      <ResidentText>{t("R27.clear")}</ResidentText>
                    </button>
                  )}
                  <Inline911 />
                </Stack>
              </section>
            )}
          </div>
        )}
      </Stack>
    </Screen>
  );
}
