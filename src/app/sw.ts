/// <reference lib="webworker" />
// The resident service worker (S02.12, AD-1). Serwist precaches the build's scripts and styles and takes over from the
// previous worker as soon as this one has installed (skipWaiting, clientsClaim); everything else is the CVH's own rules
// (offline/worker.ts, offline/rules.ts). Built by src/app/serwist/[path]/route.ts; never imported by the app.
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";
import type { PageMessage, ServedAnswer } from "@/ui/offline/protocol";
import { buildIdOf, classify } from "./offline/rules";
import { createOfflineWorker } from "./offline/worker";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const manifest = self.__SW_MANIFEST;
const origin = self.location.origin;
const worker = createOfflineWorker({ caches: self.caches, fetch: (input, init) => self.fetch(input, init), origin, build: buildIdOf(manifest) });

const serwist = new Serwist({
  precacheEntries: manifest,
  precacheOptions: { cleanupOutdatedCaches: true },
  // A new worker takes over once its install (the precache and the critical pages) has completed; until then, and if the
  // install fails, the previous worker and its caches stay in use.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: ({ request }) => classify(request, origin).kind !== "pass",
      handler: ({ request, event }) => {
        const fetchEvent = event as FetchEvent;
        return (
          worker.handle(request, { waitUntil: (promise) => fetchEvent.waitUntil(promise), resultingClientId: fetchEvent.resultingClientId }) ??
          fetch(request)
        );
      },
    },
  ],
});

self.addEventListener("install", (event) => {
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => worker.install(windows.map((w) => w.url))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(worker.activate());
});

self.addEventListener("message", (event) => {
  const message = event.data as PageMessage | null;
  if (message?.type === "cvh:keep-page" && typeof message.path === "string") {
    event.waitUntil(worker.keepPage(message.path));
  } else if (message?.type === "cvh:served") {
    const source = event.source as Client | null;
    const answer: ServedAnswer = { cachedAt: source ? worker.servedFor(source.id) : null };
    event.ports[0]?.postMessage(answer);
  }
});

serwist.addEventListeners();
