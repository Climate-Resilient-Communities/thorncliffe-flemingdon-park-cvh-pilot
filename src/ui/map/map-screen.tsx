"use client";

import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { LaunchCode } from "@/i18n/languages";
import { languageOf } from "@/i18n/languages";
import { basicAttributeSet, useBasic } from "../basic";
import { loadBuildingList } from "../choices/building-list";
import { readFilters, saveFilters, tabStorage, withoutUnknownTopics } from "../directory/filter-store";
import { activeKeys, filterProviders, isActive, listingSubcategories, listProviders, NO_FILTERS, setFilter, type FilterKey, type FilterState } from "../directory/filters";
import { formatMoment } from "../directory/format";
import { isFallbackText, ListingBlock } from "../directory/listing-text";
import { useDirectory } from "../directory/use-directory";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { singleNeighbourhood } from "../usage/nbhd";
import { UsageView } from "../usage/usage";
import { FALLBACK_MARKER, isEnglishFallback, isEnglishFallbackMessage, ResidentText } from "../text/resident-text";
import { keepBuildings, readKeptBuildings, type KeptBuilding } from "./kept-buildings";
import { createMap, type MapHandle, type PinWords, type TileSettings } from "./leaflet-map";
import { mapNotice } from "./notice";
import { buildingPins, listInView, NEIGHBOURHOODS_VIEW, pinHref, providerPins, type Bounds, type MapPin } from "./places";
import "./map.css";

/** The tile provider's settings as the page passes them (from MAP_TILE_*, src/platform/config/mapTiles.ts). */
export type MapTiles = TileSettings & { attribution: string; attributionUrl: string | null };

/** R-15 in basic mode lists this many places at a time. */
const BASIC_PAGE = 5;

const plain = (text: string) => (isEnglishFallback(text) ? text.slice(FALLBACK_MARKER.length) : text);

function phoneStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The pilot buildings' pins: the kept copy at once, then the list from the server when it answers (kept for next time). */
function useBuildingPins(): KeptBuilding[] {
  const [buildings, setBuildings] = useState<KeptBuilding[]>(() => readKeptBuildings(phoneStorage()) ?? []);
  useEffect(() => {
    let live = true;
    void loadBuildingList().then((list) => {
      if (live && list) setBuildings(keepBuildings(phoneStorage(), list));
    });
    return () => {
      live = false;
    };
  }, []);
  return buildings;
}

const subscribeOnline = (change: () => void) => {
  window.addEventListener("online", change);
  window.addEventListener("offline", change);
  return () => {
    window.removeEventListener("online", change);
    window.removeEventListener("offline", change);
  };
};

/** Whether the browser says it has a connection (true on the server and in the first render). */
const useOnline = (): boolean => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

function PinMark({ pin }: { pin: MapPin }) {
  return (
    <span className={`map-pin map-pin--${pin.marker} map-pin--inline`} aria-hidden="true">
      <span className="map-pin__mark">
        <span className={`map-ico map-ico--${pin.marker}`} />
      </span>
    </span>
  );
}

/** One choice of the map's filter panel: the same checkbox option as the directory's (R-27), in the map's own clothes. */
function FilterChoice({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className="map-option tap" data-testid={`map-filter-${id}`}>
      <input className="map-option__input" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="map-option__text">{children}</span>
    </label>
  );
}

/**
 * The map (R-14) with its list (R-15) and pin preview (R-16), S02.07. Every published provider of the directory's release
 * file, narrowed by the filters (R-27 as the pilot has it): by topic and kind of place behind the Filters button here,
 * and whatever the resident applied in the directory, one state between the two screens; and the pilot buildings, on the
 * configured tile provider's base map. A pin opens the preview card, which leads to the same listing (R-12) or building
 * page as the directory. The list shows the same places as the part of the map on screen: it is how a screen reader
 * reaches every place, so the map is never the only way. Nothing here is sent anywhere: the filters, the selected pin and
 * the part of the map viewed stay on the phone (AD-3); the tile provider sees only the tiles drawn, and the map always
 * opens on the same whole-area view.
 */
export function MapScreen({ lang, tiles }: { lang: LaunchCode; tiles: MapTiles }) {
  const t = useTranslations();
  const locale = languageOf(lang).bcp47;
  const directory = useDirectory(lang);
  const buildings = useBuildingPins();
  const online = useOnline();
  // Basic mode has no map tiles (the prototype's R-14): the same destination opens as the list, with the whole area in it.
  const basic = useBasic();
  const [chosenView, setView] = useState<"map" | "list">("map");
  const [areaInView, setBounds] = useState<Bounds>(NEIGHBOURHOODS_VIEW);
  const [pinSelected, setSelected] = useState<string | null>(null);
  const view = basic ? "list" : chosenView;
  const bounds = basic ? NEIGHBOURHOODS_VIEW : areaInView;
  const selected = basic ? null : pinSelected;
  const [missingTiles, setMissingTiles] = useState(0);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "failed">("loading");
  // The filters this visit: the ones applied here or in the directory, one state (kept in the tab, never sent).
  const [applied, setApplied] = useState<FilterState>(() => readFilters(tabStorage()));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButton = useRef<HTMLButtonElement>(null);
  // The neighbourhood this visit began with, for the usage count (S02.15): the one filter in force when the map opened, if it names one place.
  const [viewed] = useState(() => singleNeighbourhood(applied.neighbourhoods));
  const element = useRef<HTMLDivElement>(null);
  // The bar above the map that holds its zoom buttons, so no control is drawn over a pin.
  const controls = useRef<HTMLDivElement>(null);
  const handle = useRef<MapHandle | null>(null);
  const card = useRef<HTMLElement>(null);
  /** Set when "Show the whole area" was used in the list: the map shows it once it is on screen again. */
  const wholeArea = useRef(false);
  // R-15 in basic mode (the prototype's `page = b.basic ? 5 : 20`): five places at a time, "Show n more" for the next five.
  const [pages, setPages] = useState(1);
  const firstNew = useRef<HTMLUListElement>(null);
  const grew = useRef(false);

  const listing = directory.status === "ready" ? directory.listing : null;

  // Every subcategory of the release once, for the panel's choices and for dropping a kept filter the release no longer has.
  const allKinds = useMemo(() => listingSubcategories(listing?.providers ?? [], locale), [listing, locale]);
  const filters = useMemo(
    () => (listing ? withoutUnknownTopics(applied, listing.categories.map((c) => c.id), allKinds.map((kind) => kind.id)) : applied),
    [applied, listing, allKinds],
  );
  const keys = activeKeys(filters);
  const filtered = keys.length > 0;
  const topics = useMemo(() => [...(listing?.categories ?? [])].sort((a, b) => a.sort_order - b.sort_order), [listing]);
  // The subcategory choices narrow to the chosen topics; one already chosen stays listed, so it can be taken back.
  const kinds = useMemo(
    () => (listing ? listingSubcategories(listing.providers, locale, filters.categories, filters.subcategories) : []),
    [listing, locale, filters.categories, filters.subcategories],
  );

  const pins = useMemo<MapPin[]>(
    () => [...providerPins(listing ? filterProviders(listing.providers, filters) : []), ...buildingPins(buildings)],
    [listing, filters, buildings],
  );
  const inView = useMemo(() => listInView(pins, bounds, locale), [pins, bounds, locale]);
  const providersShown = basic ? inView.providers.slice(0, pages * BASIC_PAGE) : inView.providers;
  const providersLeft = inView.providers.length - providersShown.length;
  useEffect(() => {
    // The button goes when it was the last page, so focus moves to the first place it brought, and a screen reader reads on from there.
    if (!grew.current) return;
    grew.current = false;
    const first = firstNew.current?.children[(pages - 1) * BASIC_PAGE]?.querySelector<HTMLElement>("a");
    first?.focus();
  }, [pages]);
  const chosen = pins.find((pin) => pin.key === selected) ?? null;

  const kindOf = (pin: MapPin): string =>
    pin.kind === "building" ? plain(t("map.building")) : pin.label ? pin.label.body : plain(t("map.service"));
  const nameOf = (pin: MapPin): string => (pin.kind === "building" ? pin.address : pin.name);

  // The words the map draws are read through a ref, so the map is made once and still speaks the page's language.
  const words = useRef<PinWords | null>(null);
  const current: PinWords = {
    word: (pin) => (pin.kind === "provider" && pin.label ? { text: pin.label.body, lang: isFallbackText(pin.label) ? "en" : undefined } : null),
    name: (pin) => plain(t("map.pinName", { name: nameOf(pin), kind: kindOf(pin) })),
    cluster: (n) => plain(t("R14.here", { n })),
    zoomIn: plain(t("R14.zoomIn")),
    zoomOut: plain(t("R14.zoomOut")),
  };
  useEffect(() => {
    words.current = current;
  });

  useEffect(() => {
    const at = element.current;
    // The attribute is there before the first render has heard the choices: the tiles are never asked for in basic mode.
    if (!at || basic || basicAttributeSet()) return;
    let live = true;
    const proxy: PinWords = {
      word: (pin) => words.current!.word(pin),
      name: (pin) => words.current!.name(pin),
      cluster: (n) => words.current!.cluster(n),
      get zoomIn() {
        return words.current!.zoomIn;
      },
      get zoomOut() {
        return words.current!.zoomOut;
      },
    };
    createMap(at, tiles, proxy, { onView: setBounds, onSelect: setSelected, onMissingTiles: setMissingTiles }, controls.current ?? undefined)
      .then((made) => {
        if (!live) return made.destroy();
        handle.current = made;
        setMapStatus("ready");
      })
      .catch(() => {
        if (live) setMapStatus("failed");
      });
    return () => {
      live = false;
      handle.current?.destroy();
      handle.current = null;
      setMapStatus("loading");
    };
  }, [tiles, basic]);

  useEffect(() => {
    if (mapStatus === "ready") handle.current?.setPins(pins);
  }, [pins, mapStatus]);

  // A map that was hidden behind the list measures itself again when it is back on screen.
  useEffect(() => {
    if (view !== "map" || mapStatus !== "ready") return;
    handle.current?.refresh();
    if (wholeArea.current) {
      wholeArea.current = false;
      handle.current?.showWholeArea();
    }
  }, [view, mapStatus]);

  // The card takes focus when it opens, so a keyboard or screen reader user is told what was tapped.
  useEffect(() => {
    if (chosen) card.current?.focus();
  }, [chosen]);

  // The filters chosen here survive the next page of the visit, the same way the directory keeps them.
  useEffect(() => {
    saveFilters(tabStorage(), filters);
  }, [filters]);

  const notice = mapNotice({ cacheable: tiles.cacheable && tiles.cacheLimit > 0, online, missingTiles });
  const toggleFilter = (key: FilterKey, on: boolean) => setApplied((current) => setFilter(current, key, on));
  const closeFilters = () => {
    setFiltersOpen(false);
    filtersButton.current?.focus();
  };
  const clearFilters = () => {
    setApplied(NO_FILTERS);
    // The note and its button go when the filters do: focus moves to the Filters button that stays.
    filtersButton.current?.focus();
  };
  // How many providers the filters leave, for Show n results: each provider once, as the directory counts them.
  const matching = useMemo(() => (listing ? filterProviders(listProviders(listing.providers, locale), filters).length : 0), [listing, locale, filters]);
  const applyLabel = matching === 0 ? t("R27.applyNone") : matching === 1 ? t("R27.applyOne") : t("R27.apply", { n: matching });
  const showList = () => {
    setSelected(null);
    setView("list");
  };
  const total = inView.providers.length + inView.buildings.length;

  return (
    <Screen surface="resident" testId="map-page">
      <UsageView evt="map_view" lang={lang} nbhd={viewed} />
      <Stack gap="related">
        <ResidentText as="h1">{t("R14.title")}</ResidentText>
        <ResidentText as="p" className="map-hint hide-basic">
          {t("map.lead")}
        </ResidentText>
        {directory.status === "ready" && !directory.current && (
          <ResidentText as="p" className="map-hint" testId="map-last-updated">
            {t("directory.lastUpdated", { time: formatMoment(directory.publishedAt, isEnglishFallbackMessage(t, "directory.lastUpdated") ? "en-CA" : locale) })}
          </ResidentText>
        )}
        {directory.status === "loading" && (
          <ResidentText as="p" className="map-hint" testId="map-loading">
            {t("R14.loading")}
          </ResidentText>
        )}
        {directory.status === "unavailable" && (
          <ResidentText as="p" className="map-hint" testId="map-directory-unavailable">
            {t("directory.couldNotLoad")}
          </ResidentText>
        )}
        <div className="map-segment hide-basic" role="group" aria-label={plain(t("R14.title"))}>
          <button type="button" className="map-segment__btn tap" aria-pressed={view === "map"} onClick={() => setView("map")} data-testid="map-view-map">
            <span className="map-ico map-ico--map" aria-hidden="true" />
            <ResidentText>{t("R14.mapView")}</ResidentText>
          </button>
          <button type="button" className="map-segment__btn tap" aria-pressed={view === "list"} onClick={showList} data-testid="map-view-list">
            <span className="map-ico map-ico--list" aria-hidden="true" />
            <ResidentText>{t("R14.list")}</ResidentText>
          </button>
        </div>
        {/* The filters (R-27 as the pilot has it, here by topic and kind of place): the same state the directory narrows by,
            applied on the phone. On every width they sit behind the Filters button, so the map keeps the screen. */}
        {listing && (
          <section className="map-filters" aria-label={plain(t("R27.title"))} data-testid="map-filters">
            <Stack gap="related">
              <button
                ref={filtersButton}
                type="button"
                className="map-btn map-btn--secondary tap"
                aria-expanded={filtersOpen}
                aria-controls="map-filter-panel"
                onClick={() => setFiltersOpen((open) => !open)}
                data-testid="map-filters-toggle"
              >
                <ResidentText>{keys.length > 0 ? t("R10.filtersCount", { n: keys.length }) : t("R10.filters")}</ResidentText>
              </button>
              <div id="map-filter-panel" className="map-filter-panel" data-open={filtersOpen} data-testid="map-filter-panel">
                <Stack gap="stack">
                  <ResidentText as="p" className="map-hint">
                    {t("R27.private")}
                  </ResidentText>
                  <fieldset className="map-fieldset">
                    <ResidentText as="legend" className="map-legend" testId="map-legend-topic">
                      {t("directory.topic")}
                    </ResidentText>
                    <Stack gap="label">
                      {topics.map((category) => (
                        <FilterChoice
                          key={category.id}
                          id={`category-${category.id}`}
                          checked={isActive(filters, { kind: "category", id: category.id })}
                          onChange={(on) => toggleFilter({ kind: "category", id: category.id }, on)}
                        >
                          <ListingBlock text={category.name} as="span" />
                        </FilterChoice>
                      ))}
                    </Stack>
                  </fieldset>
                  {kinds.length > 0 && (
                    <fieldset className="map-fieldset">
                      <ResidentText as="legend" className="map-legend" testId="map-legend-kind">
                        {t("R14.subLabel")}
                      </ResidentText>
                      <Stack gap="label">
                        {kinds.map((kind) => (
                          <FilterChoice
                            key={kind.id}
                            id={`subcategory-${kind.id}`}
                            checked={isActive(filters, { kind: "subcategory", id: kind.id })}
                            onChange={(on) => toggleFilter({ kind: "subcategory", id: kind.id }, on)}
                          >
                            <ListingBlock text={kind.name} as="span" />
                          </FilterChoice>
                        ))}
                      </Stack>
                    </fieldset>
                  )}
                  <div className="map-filter-actions">
                    <button type="button" className="map-btn map-btn--primary tap" onClick={closeFilters} data-testid="map-filters-apply">
                      <ResidentText>{applyLabel}</ResidentText>
                    </button>
                    <button type="button" className="map-btn map-btn--secondary tap" onClick={() => setApplied(NO_FILTERS)} data-testid="map-filters-clear">
                      <ResidentText>{t("R27.clear")}</ResidentText>
                    </button>
                  </div>
                </Stack>
              </div>
            </Stack>
          </section>
        )}
        {filtered && (
          <div className="map-filtered" role="note" data-testid="map-filtered">
            <ResidentText as="p">{t("map.filtered")}</ResidentText>
            <button type="button" className="map-btn map-btn--quiet tap" onClick={clearFilters} data-testid="map-clear-filters">
              <ResidentText>{t("R15.clearAll")}</ResidentText>
            </button>
          </div>
        )}
      </Stack>

      {/* The map and its list. On a phone one of them is on screen at a time (the Map / List switch); from the desktop breakpoint they are
          side by side, the list following the part of the map on screen (desktop.css). The list is always rendered, and on a phone in the
          map view it is not displayed, so it is out of the accessibility tree there as before. Simpler view is the list alone everywhere. */}
      <div className="map-work" data-view={view} data-layout="columns" data-testid="map-work">
      <section className="map-frame" hidden={view !== "map"} aria-label={plain(t("R14.mapLabel"))} data-testid="map-frame">
        {/* The map is a picture: Leaflet lays it out left to right in every language; the words on it carry their own direction. */}
        <div ref={controls} className="map-tools" dir="ltr" data-testid="map-tools" />
        <div ref={element} className="map-canvas" dir="ltr" data-testid="map-canvas" data-status={mapStatus} />
        <p className="map-credit" lang="en" dir="ltr" data-testid="map-credit">
          {tiles.attributionUrl ? (
            <a href={tiles.attributionUrl} target="_blank" rel="noopener noreferrer">
              {tiles.attribution}
            </a>
          ) : (
            tiles.attribution
          )}
        </p>
        {mapStatus === "loading" && (
          <div className="map-msg" role="status">
            <ResidentText as="p" className="map-strong">
              {t("R14.loading")}
            </ResidentText>
          </div>
        )}
        {mapStatus === "failed" && (
          <div className="map-msg" role="status" data-testid="map-failed">
            <ResidentText as="p" className="map-strong">
              {t("R14.unavailable")}
            </ResidentText>
            <button type="button" className="map-btn map-btn--primary tap" onClick={showList}>
              <ResidentText>{t("R14.showList")}</ResidentText>
            </button>
          </div>
        )}
        {mapStatus === "ready" && notice === "no-signal" && (
          <div className="map-msg" role="status" data-testid="map-no-signal">
            <ResidentText as="p" className="map-strong">
              {t("map.noSignal")}
            </ResidentText>
            <ResidentText as="p">{t("map.noSignalBody")}</ResidentText>
            <button type="button" className="map-btn map-btn--primary tap" onClick={showList} data-testid="map-no-signal-list">
              <ResidentText>{t("R14.showList")}</ResidentText>
            </button>
          </div>
        )}
        {mapStatus === "ready" && notice === "not-saved" && (
          <div className="map-band" role="status" data-testid="map-not-saved">
            <ResidentText as="p" className="map-strong">
              {t("map.notSaved")}
            </ResidentText>
            <ResidentText as="p">{t("map.notSavedBody")}</ResidentText>
          </div>
        )}
        {chosen && (
          <section ref={card} className="map-preview" tabIndex={-1} aria-labelledby="map-preview-name" data-testid="map-preview">
            <div className="map-preview__head">
              <PinMark pin={chosen} />
              <span className="map-preview__kind" data-testid="map-preview-kind">
                {chosen.kind === "provider" && chosen.label ? <ListingBlock text={chosen.label} as="span" /> : <ResidentText>{chosen.kind === "building" ? t("map.building") : t("map.service")}</ResidentText>}
              </span>
              <button type="button" className="map-close tap" onClick={() => setSelected(null)} aria-label={plain(t("R16.close"))} data-testid="map-preview-close">
                <span className="map-ico map-ico--close" aria-hidden="true" />
              </button>
            </div>
            <h2 id="map-preview-name" className="map-preview__name">
              {nameOf(chosen)}
            </h2>
            {chosen.kind === "provider" ? (
              <p className="map-hint">{chosen.street}</p>
            ) : (
              <p className="map-hint">{chosen.neighbourhood}</p>
            )}
            <Link href={pinHref(chosen, lang)} prefetch={false} className="map-btn map-btn--primary tap" data-testid="map-preview-open">
              <ResidentText>{t("R16.open")}</ResidentText>
            </Link>
          </section>
        )}
      </section>

      <section className="map-list" aria-label={plain(t("map.listTitle"))} data-testid="map-list">
          <Stack gap="section-resident">
            <Stack gap="related">
              <ResidentText as="h2" testId="map-list-title">
                {t("map.listTitle")}
              </ResidentText>
              <ResidentText as="p" className="map-hint hide-basic">
                {t("map.listLead")}
              </ResidentText>
            </Stack>
            {total === 0 ? (
              <Stack gap="related">
                <ResidentText as="p" testId="map-list-empty">
                  {t("map.listEmpty")}
                </ResidentText>
                <button
                  type="button"
                  className="map-btn map-btn--secondary tap hide-basic"
                  onClick={() => {
                    // Beside the map (a desktop) the map is already on screen: show the whole area now.
                    if (view === "map") return handle.current?.showWholeArea();
                    setView("map");
                    wholeArea.current = true;
                  }}
                  data-testid="map-whole-area"
                >
                  <ResidentText>{t("map.wholeArea")}</ResidentText>
                </button>
              </Stack>
            ) : (
              <>
                {inView.providers.length > 0 && (
                  <Stack gap="related">
                    <ResidentText as="h3">{t("directory.title")}</ResidentText>
                    <ResidentText as="p" className="map-hint" testId="map-list-count">
                      {inView.providers.length === 1 ? t("R15.countOne") : t("R15.count", { n: inView.providers.length })}
                    </ResidentText>
                    <ul className="map-entries" data-testid="map-list-providers" ref={firstNew}>
                      {providersShown.map((pin) => (
                        <li key={pin.id} className="map-entry" data-testid={`map-entry-${pin.id}`}>
                          <PinMark pin={pin} />
                          <span className="map-entry__text">
                            <Link href={pinHref(pin, lang)} prefetch={false} className="map-entry__link">
                              {pin.name}
                            </Link>
                            <span className="map-hint">{pin.label ? <ListingBlock text={pin.label} as="span" /> : <ResidentText>{t("map.service")}</ResidentText>}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {providersLeft > 0 && (
                      <button
                        type="button"
                        className="map-btn map-btn--secondary tap"
                        onClick={() => {
                          grew.current = true;
                          setPages((n) => n + 1);
                        }}
                        data-testid="map-list-more"
                      >
                        <ResidentText>{t("R15.more", { n: Math.min(BASIC_PAGE, providersLeft) })}</ResidentText>
                      </button>
                    )}
                  </Stack>
                )}
                {inView.buildings.length > 0 && (
                  <Stack gap="related">
                    <ResidentText as="h3">{t("map.buildings")}</ResidentText>
                    <ResidentText as="p" className="map-hint" testId="map-list-building-count">
                      {inView.buildings.length === 1 ? t("map.buildingsCountOne") : t("map.buildingsCount", { n: inView.buildings.length })}
                    </ResidentText>
                    <ul className="map-entries" data-testid="map-list-buildings">
                      {inView.buildings.map((pin) => (
                        <li key={pin.rsn} className="map-entry" data-testid={`map-entry-building-${pin.rsn}`}>
                          <PinMark pin={pin} />
                          <span className="map-entry__text">
                            <Link href={pinHref(pin, lang)} prefetch={false} className="map-entry__link">
                              <bdi>{pin.address}</bdi>
                            </Link>
                            <span className="map-hint">{pin.neighbourhood}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Stack>
                )}
              </>
            )}
          </Stack>
        </section>
      </div>
    </Screen>
  );
}
