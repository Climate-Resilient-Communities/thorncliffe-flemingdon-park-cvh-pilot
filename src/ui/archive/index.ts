// The archive's import surface (S05.07): app code imports from "@/ui/archive". Separate from "@/ui" for the same reason as "@/ui/alert": it pulls in Next's link component.
export { ArchiveScreen } from "./archive-screen";
export { archiveCards, joinPages, type ArchiveCard } from "./archive-view";
