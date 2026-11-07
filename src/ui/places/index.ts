// The place suggestion screens' import surface (PRD §6.3; R-17 to R-23): app code imports from "@/ui/places". Separate from "@/ui" because they
// pull in next-intl, the phone's storage and, for R-20's pin, Leaflet (loaded in the browser only).
export { AddPlaceFlow } from "./add-flow";
export { CorrectPlace } from "./correct-place";
export { SubmissionStatusPage } from "./submission-status";
export type { RulesTexts } from "./parts";
