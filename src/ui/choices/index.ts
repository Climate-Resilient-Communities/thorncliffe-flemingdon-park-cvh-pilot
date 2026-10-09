// The first-run choices' import surface (S02.03): app code imports from "@/ui/choices". Separate from "@/ui" for the
// same reason as "@/ui/shell": these pull in Next's navigation and link components and next-intl.
export { ChoicesLink } from "./choices-link";
export { FirstRunGate } from "./first-run-gate";
export { GroupsStep } from "./groups-step";
export { LanguageStep, type StepLanguage } from "./language-step";
export { MyChoices } from "./my-choices";
export { PlaceStep } from "./place-step";
export type { StepMode } from "./parts";
export { useGateBuildingList } from "./building-list-context";
export { useChoices, type BuildingListState } from "./use-choices";
export { RootEntry, SavedLanguageNotFound } from "./saved-language";
