"use client";

import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LaunchCode } from "@/i18n/languages";
import { languageOf } from "@/i18n/languages";
import { loadBuildingList } from "../choices/building-list";
import { readFilters, saveFilters, tabStorage, withoutUnknownTopics } from "../directory/filter-store";
import { activeKeys, filterProviders, NO_FILTERS, type FilterState } from "../directory/filters";
import { formatMoment } from "../directory/format";
import { isFallbackText, ListingBlock } from "../directory/listing-text";
import { useDirectory } from "../directory/use-directory";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { FALLBACK_MARKER, isEnglishFallback, isEnglishFallbackMessage, ResidentText } from "../text/resident-text";
import { keepBuildings, readKeptBuildings, type KeptBuilding } from "./kept-buildings";
import { createMap, type MapHandle, type PinWords, type TileSettings } from "./leaflet-map";
import { mapNotice } from "./notice";
import { buildingPins, listInView, NEIGHBOURHOODS_VIEW, pinHref, providerPins, type Bounds, type MapPin } from "./places";
import "./map.css";

/** The tile provider's settings as the page passes them (from MAP_TILE_*, src/platform/config/mapTiles.ts). */
export type MapTiles = TileSettings & { attribution: string; attributionUrl: string | null };

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

/**
 * The map (R-14) with its list (R-15) and pin preview (R-16), S02.07. Every published provider of the directory's release
 * file, narrowed by the filters the resident applied in the directory, and the pilot buildings, on the configured tile
 * provider's base map. A pin opens the preview card, which leads to the same listing (R-12) or building page as the
 * directory. The list shows the same places as the part of the map on screen: it is how a screen reader reaches every
 * place, so the map is never the only way. Nothing here is sent anywhere: the filters, the selected pin and the part of
 * the map viewed stay on the phone (AD-3); the tile provider sees only the tiles drawn, and the map always opens on the
 * same whole-area view.
 */
export function MapScreen({ lang, tiles }: { lang: LaunchCode; tiles: MapTiles }) {
  const t = useTranslations();
  const locale = languageOf(lang).bcp47;
  const directory = useDirectory(lang);
  const buildings = useBuildingPins();
  const online = useOnline();
  const [view, setView] = useState<"map" | "list">("map");
  const [bounds, setBounds] = useState<Bounds>(NEIGHBOURHOODS_VIEW);
  const [selected, setSelected] = useState<string | null>(null);
  const [missingTiles, setMissingTiles] = useState(0);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "failed">("loading");
  // The filters applied in the directory this visit (kept in the tab, never sent).
  const [applied, setApplied] = useState<FilterState>(() => readFilters(tabStorage()));
  const element = useRef<HTMLDivElement>(null);
  const handle = useRef<MapHandle | null>(null);
  const card = useRef<HTMLElement>(null);
  /** Set when "Show the whole area" was used in the list: the map shows it once it is on screen again. */
  const wholeArea = useRef(false);

  const listing = directory.status === "ready" ? directory.listing : null;

  const filters = useMemo(() => (listing ? withoutUnknownTopics(applied, listing.categories.map((c) => c.id)) : applied), [applied, listing]);
  const filtered = activeKeys(filters).length > 0;

  const pins = useMemo<MapPin[]>(
    () => [...providerPins(listing ? filterProviders(listing.providers, filters) : []), ...buildingPins(buildings)],
    [listing, filters, buildings],
  );
  const inView = useMemo(() => listInView(pins, bounds, locale), [pins, bounds, locale]);
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
    if (!at) return;
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
    createMap(at, tiles, proxy, { onView: setBounds, onSelect: setSelected, onMissingTiles: setMissingTiles })
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
    };
  }, [tiles]);

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

  const notice = mapNotice({ cacheable: tiles.cacheable && tiles.cacheLimit > 0, online, missingTiles });
  const clearFilters = () => {
    saveFilters(tabStorage(), NO_FILTERS);
    setApplied(NO_FILTERS);
  };
  const showList = () => {
    setSelected(null);
    setView("list");
  };
  const total = inView.providers.length + inView.buildings.length;

  return (
    <Screen surface="resident" testId="map-page">
      <Stack gap="related">
        <ResidentText as="h1">{t("R14.title")}</ResidentText>
        <ResidentText as="p" className="map-hint">
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
        <div className="map-segment" role="group" aria-label={plain(t("R14.title"))}>
          <button type="button" className="map-segment__btn tap" aria-pressed={view === "map"} onClick={() => setView("map")} data-testid="map-view-map">
            <span className="map-ico map-ico--map" aria-hidden="true" />
            <ResidentText>{t("R14.mapView")}</ResidentText>
          </button>
          <button type="button" className="map-segment__btn tap" aria-pressed={view === "list"} onClick={showList} data-testid="map-view-list">
            <span className="map-ico map-ico--list" aria-hidden="true" />
            <ResidentText>{t("R14.list")}</ResidentText>
          </button>
        </div>
        {filtered && (
          <div className="map-filtered" role="note" data-testid="map-filtered">
            <ResidentText as="p">{t("map.filtered")}</ResidentText>
            <button type="button" className="map-btn map-btn--quiet tap" onClick={clearFilters} data-testid="map-clear-filters">
              <ResidentText>{t("R15.clearAll")}</ResidentText>
            </button>
          </div>
        )}
      </Stack>

      <section className="map-frame" hidden={view !== "map"} aria-label={plain(t("R14.mapLabel"))} data-testid="map-frame">
        {/* The map is a picture: Leaflet lays it out left to right in every language; the words on it carry their own direction. */}
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

      {view === "list" && (
        <section className="map-list" aria-label={plain(t("map.listTitle"))} data-testid="map-list">
          <Stack gap="section-resident">
            <Stack gap="related">
              <ResidentText as="h2" testId="map-list-title">
                {t("map.listTitle")}
              </ResidentText>
              <ResidentText as="p" className="map-hint">
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
                  className="map-btn map-btn--secondary tap"
                  onClick={() => {
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
                    <ul className="map-entries" data-testid="map-list-providers">
                      {inView.providers.map((pin) => (
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
      )}
    </Screen>
  );
}
