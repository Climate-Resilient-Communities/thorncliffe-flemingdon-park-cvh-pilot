// Stands in for `next/navigation` in the layout harness (e2e/helpers/layout-fixture.ts), which bundles the fixtures for the browser without Next's runtime. The sending
// progress reloads itself through the router (src/app/staff/alerts/sending/AutoRefresh.tsx); the layout fixtures draw it without the timer, and when the client bundle
// hydrates a fixture the router does nothing. Only the harness uses this file.
export function useRouter() {
  return { refresh: () => undefined, push: () => undefined, replace: () => undefined, back: () => undefined, forward: () => undefined, prefetch: () => undefined };
}
