// The small part of Leaflet 1.9 and Leaflet.markercluster 1.5 the resident map uses (S02.07). The packages ship no
// types and @types/leaflet is not a dependency, so only what leaflet-map.ts calls is declared here.
declare module "leaflet" {
  export type LatLngTuple = [number, number];
  export interface LatLngBounds {
    getSouth(): number;
    getWest(): number;
    getNorth(): number;
    getEast(): number;
  }
  export interface Point {
    x: number;
    y: number;
  }
  export interface Coords extends Point {
    z: number;
  }
  export interface LeafletEvent {
    type: string;
    target: unknown;
  }
  export interface TileEvent extends LeafletEvent {
    tile: HTMLImageElement;
    coords: Coords;
  }
  export interface Evented {
    on(type: string, fn: (event: never) => void): this;
    off(type?: string, fn?: (event: never) => void): this;
  }
  export interface Layer extends Evented {
    addTo(map: LeafletMap): this;
    remove(): this;
  }
  export interface LeafletMap extends Evented {
    getBounds(): LatLngBounds;
    getZoom(): number;
    fitBounds(bounds: [LatLngTuple, LatLngTuple], options?: { animate?: boolean }): this;
    setView(center: LatLngTuple, zoom: number, options?: { animate?: boolean }): this;
    panTo(center: LatLngTuple, options?: { animate?: boolean }): this;
    invalidateSize(): this;
    remove(): this;
    getContainer(): HTMLElement;
  }
  export interface DivIcon {
    readonly options: unknown;
  }
  export interface Marker extends Layer {
    getElement(): HTMLElement | undefined;
  }
  export interface TileLayer extends Layer {
    getTileUrl(coords: Coords): string;
  }
  export interface TileLayerOptions {
    maxZoom?: number;
    maxNativeZoom?: number;
    subdomains?: string;
    attribution?: string;
    crossOrigin?: boolean | string;
    keepBuffer?: number;
    updateWhenIdle?: boolean;
    className?: string;
  }
  export interface TileLayerClass {
    new (url: string, options?: TileLayerOptions): TileLayer;
    extend(props: Record<string, unknown>): TileLayerClass;
  }
  export interface MarkerCluster {
    getChildCount(): number;
  }
  export interface MarkerClusterGroup extends Layer {
    addLayers(layers: Marker[]): this;
    clearLayers(): this;
  }
  export interface Leaflet {
    map(
      element: HTMLElement,
      options?: {
        zoomControl?: boolean;
        attributionControl?: boolean;
        minZoom?: number;
        maxZoom?: number;
        maxBounds?: [LatLngTuple, LatLngTuple];
        maxBoundsViscosity?: number;
        keyboard?: boolean;
      },
    ): LeafletMap;
    divIcon(options: { html: string; className: string; iconSize: [number, number]; iconAnchor?: [number, number] }): DivIcon;
    marker(at: LatLngTuple, options: { icon: DivIcon; keyboard?: boolean; riseOnHover?: boolean }): Marker;
    control: {
      zoom(options: { position?: string; zoomInTitle?: string; zoomOutTitle?: string; zoomInText?: string; zoomOutText?: string }): Layer & { addTo(map: LeafletMap): unknown };
    };
    TileLayer: TileLayerClass;
    /** The map's handlers; only the keyboard handler's first-press focus is replaced (leaflet-map.ts). */
    Map?: { Keyboard?: { prototype: { _onMouseDown?: (this: { _focused?: boolean; _map: LeafletMap }) => void } } };
    Util: { template(template: string, data: Record<string, unknown>): string };
    markerClusterGroup?(options: {
      showCoverageOnHover?: boolean;
      maxClusterRadius?: number;
      spiderfyOnMaxZoom?: boolean;
      chunkedLoading?: boolean;
      iconCreateFunction?: (cluster: MarkerCluster) => DivIcon;
    }): MarkerClusterGroup;
  }
  const L: Leaflet;
  export default L;
}

declare module "leaflet.markercluster";
