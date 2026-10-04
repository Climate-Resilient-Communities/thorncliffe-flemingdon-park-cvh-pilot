// Offline reading's import surface (S02.12): app code imports from "@/ui/offline". The service worker itself is
// src/app/sw.ts; protocol.ts is what the two sides agree on.
export { OfflineSupport } from "./offline-support";
export { KeptPages } from "./kept-pages";
export { useOfflineSupport } from "./use-offline-support";
export * from "./protocol";
