// The resident map's import surface (S02.07): app code imports from "@/ui/map". Separate from "@/ui" because it pulls
// in Leaflet (loaded in the browser only), next-intl and the phone's storage.
export { MapScreen, type MapTiles } from "./map-screen";
