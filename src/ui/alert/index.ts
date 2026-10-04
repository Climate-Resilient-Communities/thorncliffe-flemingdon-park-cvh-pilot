// The alert screens' import surface (S04.08): app code imports from "@/ui/alert". Separate from "@/ui" because it pulls in Next's link component
// and the resident shell's icons, which the layout primitives (and the layout tests that bundle them without Next) do not need.
export { AlertCard } from "./alert-card";
export { AlertDetail } from "./alert-detail";
export { VerifiedExplainer } from "./verified-explainer";
export { alertView, originOf, TYPE_IDS, type AlertView, type EntryView, type OriginView, type TextView, type Translate, type TypeView } from "./alert-view";
export { guideDuringHref, guidesFor, MAPPED_GUIDES } from "./guides";
export { validUntilLine } from "./times";
export { FollowDeviceLanguage } from "./follow-device-language";
export { PLACE_ADDRESSES_SHOWN, placeLine } from "./place";
export { shareLink, shareMessage, whatsappHref, type ShareMessage } from "./share-message";
export { ShareScreen } from "./share-screen";
