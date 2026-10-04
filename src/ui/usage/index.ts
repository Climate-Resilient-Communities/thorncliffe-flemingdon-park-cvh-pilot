// Usage counts' import surface (S02.15): app code imports from "@/ui/usage". Everything here ends in one fixed message,
// `{evt, lang, nbhd?}` (src/contracts/usage.ts), sent by send.ts.
export { InstallCount, UsageView } from "./usage";
export { singleNeighbourhood } from "./nbhd";
