import type { Coords, DivIcon, Leaflet, LeafletMap, Marker, TileEvent } from "leaflet";
import type { Bounds, MapPin } from "./places";
import { NEIGHBOURHOODS_VIEW } from "./places";
import { cacheStorageStore, clearKeptTiles, createTileLoader, pruneStore, TileIndex, type IndexStorage } from "./tile-cache";

// The map itself (R-14): Leaflet with clustered pins (Leaflet.markercluster), drawn into an element React gives it. Only
// the browser runs this; the page loads Leaflet when the map is first shown.
//
// Tiles: with a provider that allows it, each tile goes through the phone's tile cache (tile-cache.ts), which serves a
// kept tile and keeps the ones it downloads; a tile it has neither (no signal, never viewed) is drawn as nothing over the
// map's plain background and reported, so the screen can say that part of the map is not saved. With a provider that
// does not allow it, tiles are ordinary images and nothing is kept. Leaflet asks only for the tiles on screen; nothing is
// fetched ahead.

export type TileSettings = {
  urlTemplate: string;
  subdomains: string;
  maxZoom: number;
  cacheable: boolean;
  cacheLimit: number;
  cacheDays: number;
};

export type PinWords = {
  /** The visible words beside a pin, or null for none (a service pin). */
  word(pin: MapPin): { text: string; lang?: string } | null;
  /** The pin's name as a screen reader says it: its name and its kind. */
  name(pin: MapPin): string;
  /** "{n} places here", for a cluster. */
  cluster(n: number): string;
  zoomIn: string;
  zoomOut: string;
};

export type MapHandle = {
  setPins(pins: readonly MapPin[]): void;
  showWholeArea(): void;
  /** Measures the map again after it was hidden. */
  refresh(): void;
  bounds(): Bounds;
  destroy(): void;
};

export type MapCallbacks = {
  onView(bounds: Bounds): void;
  onSelect(key: string): void;
  /** How many tiles on screen could not be drawn (no signal and not kept). */
  onMissingTiles(count: number): void;
};

const MIN_ZOOM = 12;
/** A little more than the two neighbourhoods: the map does not wander off across the city. */
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [43.64, -79.47],
  [43.79, -79.2],
];
const HOME: [[number, number], [number, number]] = [
  [NEIGHBOURHOODS_VIEW.south, NEIGHBOURHOODS_VIEW.west],
  [NEIGHBOURHOODS_VIEW.north, NEIGHBOURHOODS_VIEW.east],
];

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function pinIcon(L: Leaflet, pin: MapPin, words: PinWords): DivIcon {
  const word = words.word(pin);
  const wordHtml = word
    ? // The label is placed in the map's left-to-right frame; only its words take their own direction.
      `<span class="map-pin__word" aria-hidden="true"><span dir="auto"${word.lang ? ` lang="${escape(word.lang)}"` : ""}>${escape(word.text)}</span></span>`
    : "";
  return L.divIcon({
    className: `map-pin map-pin--${pin.marker}`,
    // Leaflet's own stylesheet (not in a layer) makes the icon element a block, so the layout is on an inner body.
    html: `<span class="map-pin__body"><span class="map-pin__mark" aria-hidden="true"><span class="map-ico map-ico--${pin.marker}"></span></span>${wordHtml}<span class="map-sr">${escape(words.name(pin))}</span></span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

const boundsOf = (map: LeafletMap): Bounds => {
  const b = map.getBounds();
  return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
};

function localStore(): IndexStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Loads Leaflet and the cluster plugin (which expects Leaflet as the global `L`). */
async function loadLeaflet(): Promise<Leaflet> {
  const leaflet = (await import("leaflet")) as unknown as { default?: Leaflet } & Leaflet;
  const L = leaflet.default ?? leaflet;
  (window as unknown as { L: Leaflet }).L = L;
  await import("leaflet.markercluster");
  // Leaflet focuses the map on the first press so the arrow keys pan it, and puts back only the window's scroll. In the
  // resident shell the page scrolls inside the main area, so that focus scrolled the map under the finger and the tap
  // missed its pin. Focus without scrolling instead.
  const keyboard = L.Map?.Keyboard?.prototype;
  if (keyboard) {
    keyboard._onMouseDown = function (this: { _focused?: boolean; _map: LeafletMap }) {
      if (!this._focused) this._map.getContainer().focus({ preventScroll: true });
    };
  }
  return L;
}

export async function createMap(element: HTMLElement, tiles: TileSettings, words: PinWords, callbacks: MapCallbacks): Promise<MapHandle> {
  const L = await loadLeaflet();
  const map = L.map(element, { zoomControl: false, attributionControl: false, minZoom: MIN_ZOOM, maxZoom: tiles.maxZoom, maxBounds: MAX_BOUNDS, maxBoundsViscosity: 0.8 });
  L.control.zoom({ position: "topright", zoomInTitle: words.zoomIn, zoomOutTitle: words.zoomOut }).addTo(map);

  // Which tiles on screen could not be drawn, by their place in the grid.
  const missing = new Set<string>();
  const keyOf = (c: Coords) => `${c.z}/${c.x}/${c.y}`;
  const report = () => callbacks.onMissingTiles(missing.size);
  const objectUrls = new WeakMap<HTMLImageElement, string>();

  const tileOptions = { maxZoom: tiles.maxZoom, subdomains: tiles.subdomains || "abc", keepBuffer: 0, updateWhenIdle: true, className: "map-tiles" };
  if (tiles.cacheable && tiles.cacheLimit > 0) {
    const storage = localStore();
    const index = new TileIndex(tiles.cacheLimit, storage);
    const store = cacheStorageStore();
    if (store) void pruneStore(store, index);
    const loader = createTileLoader({ limit: tiles.cacheLimit, cacheDays: tiles.cacheDays, store, index });
    const CachedTiles = L.TileLayer.extend({
      createTile(this: { getTileUrl(c: Coords): string }, coords: Coords, done: (error: Error | null, tile: HTMLElement) => void) {
        const img = document.createElement("img");
        img.alt = "";
        img.setAttribute("role", "presentation");
        const key = keyOf(coords);
        void loader.load(this.getTileUrl(coords)).then((result) => {
          if (result.kind === "missing") {
            img.classList.add("map-tile--missing");
            missing.add(key);
            report();
            done(null, img);
            return;
          }
          const url = URL.createObjectURL(result.blob);
          objectUrls.set(img, url);
          img.onload = () => done(null, img);
          img.onerror = () => done(null, img);
          img.src = url;
          if (missing.delete(key)) report();
        });
        return img;
      },
    });
    const layer = new CachedTiles(tiles.urlTemplate, tileOptions).addTo(map);
    layer.on("tileunload", (event: TileEvent) => {
      const url = objectUrls.get(event.tile);
      if (url) URL.revokeObjectURL(url);
      if (missing.delete(keyOf(event.coords))) report();
    });
  } else {
    // Not allowed to keep tiles: forget any kept under an earlier provider, and let the browser load each tile as an image.
    void clearKeptTiles(localStore());
    const layer = new L.TileLayer(tiles.urlTemplate, tileOptions).addTo(map);
    layer.on("tileerror", (event: TileEvent) => {
      event.tile.classList.add("map-tile--missing");
      missing.add(keyOf(event.coords));
      report();
    });
    layer.on("tileload", (event: TileEvent) => {
      if (missing.delete(keyOf(event.coords))) report();
    });
    layer.on("tileunload", (event: TileEvent) => {
      if (missing.delete(keyOf(event.coords))) report();
    });
  }

  const clusters = L.markerClusterGroup!({
    showCoverageOnHover: false,
    maxClusterRadius: 48,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: (cluster) => {
      const n = cluster.getChildCount();
      return L.divIcon({
        className: "map-cluster",
        html: `<span class="map-cluster__body"><span aria-hidden="true">${n}</span><span class="map-sr">${escape(words.cluster(n))}</span></span>`,
        iconSize: [48, 48],
      });
    },
  }).addTo(map);

  // The zoom the map has settled on, on the element (the end-to-end tests wait for it).
  const markZoom = () => element.setAttribute("data-zoom", String(map.getZoom()));
  map.on("zoomend", markZoom);
  map.on("moveend", () => callbacks.onView(boundsOf(map)));
  map.fitBounds(HOME, { animate: false });
  markZoom();
  callbacks.onView(boundsOf(map));

  return {
    setPins(pins) {
      clusters.clearLayers();
      const markers: Marker[] = pins.map((pin) => {
        const marker = L.marker([pin.lat, pin.lng], { icon: pinIcon(L, pin, words), keyboard: true, riseOnHover: true });
        marker.on("click", () => callbacks.onSelect(pin.key));
        return marker;
      });
      clusters.addLayers(markers);
    },
    showWholeArea() {
      map.fitBounds(HOME, { animate: false });
    },
    refresh() {
      map.invalidateSize();
    },
    bounds: () => boundsOf(map),
    destroy() {
      map.remove();
    },
  };
}

