"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { basicAttributeSet, useBasic } from "../basic";
import { createMiniMap, type TileSettings } from "./leaflet-map";
import type { MarkerKind } from "./places";
import "./map.css";

/** The tile provider's settings as a page passes them (from MAP_TILE_*, src/platform/config/mapTiles.ts): the map page's own. */
export type MiniMapTiles = TileSettings & { attribution: string; attributionUrl: string | null };

/**
 * A small, still map of the whole area with one place marked (createMiniMap), for a provider's page on a desktop. It is drawn only
 * once its box has a size: the side panel it sits in is not displayed on a phone (desktop.css), so a phone never loads Leaflet or a
 * tile for it. Simpler view has no map tiles anywhere (as the map page), so it is not drawn there either. The map is a picture beside
 * the place's address, which is in words in the panel, so it is hidden from assistive technology; the tile credit stays readable.
 */
export function MiniMap({ tiles, lat, lng, marker }: { tiles: MiniMapTiles; lat: number; lng: number; marker: MarkerKind }) {
  const element = useRef<HTMLDivElement>(null);
  const basic = useBasic();
  const [status, setStatus] = useState<"waiting" | "ready" | "failed">("waiting");

  useEffect(() => {
    const at = element.current;
    if (!at || basic || basicAttributeSet()) return;
    let live = true;
    let started = false;
    let handle: { destroy(): void } | null = null;
    const start = () => {
      if (started || at.clientWidth === 0) return;
      started = true;
      createMiniMap(at, tiles, { lat, lng, marker })
        .then((made) => {
          if (!live) return made.destroy();
          handle = made;
          setStatus("ready");
        })
        .catch(() => {
          if (live) setStatus("failed");
        });
    };
    const observer = new ResizeObserver(start);
    observer.observe(at);
    start();
    return () => {
      live = false;
      observer.disconnect();
      handle?.destroy();
    };
  }, [tiles, lat, lng, marker, basic]);

  if (basic || status === "failed") return null;
  return (
    <div className="map-mini" data-testid="provider-mini-map" data-status={status}>
      {/* The map is a picture: Leaflet lays it out left to right in every language. */}
      <div ref={element} className="map-mini__canvas" dir="ltr" aria-hidden="true" />
      <p className="map-mini__credit" lang="en" dir="ltr">
        {tiles.attributionUrl ? (
          <a href={tiles.attributionUrl} target="_blank" rel="noopener noreferrer">
            {tiles.attribution}
          </a>
        ) : (
          tiles.attribution
        )}
      </p>
    </div>
  );
}
