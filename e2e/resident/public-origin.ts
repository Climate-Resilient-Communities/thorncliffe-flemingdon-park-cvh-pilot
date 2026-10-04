// The public origin (PUBLIC_BASE_URL) each server of the resident page tests is started with: fixed, so it does not follow the port the run happens to use. The share
// screen (R-29, S05.08) shows the share link built from it, and a baseline screenshot of that screen would differ between a run on a local port and a run in CI if the
// origin were the server's own address. They are names that never resolve: nothing in the resident tests may fetch them.
//
// There is one for each server, not one for all: the app keeps the feed in Next's data cache under a key that includes the public origin (src/app/feedCache.ts), which is
// what keeps the server that has no alerts from reading the entry of the server that has them, in the one build folder they share.
export const PUBLIC_ORIGIN = "https://cvh-resident-tests.example";
export const PUBLIC_ORIGINS = {
  /** The server with no alerts (every page but the alert pages). */
  main: "https://main.cvh-resident-tests.example",
  /** The server with the alerts of fixtures/feed.json: the one the share screen is tested on. */
  alerts: PUBLIC_ORIGIN,
  /** The server with catalog keys shown as English fallback. */
  fallback: "https://fallback.cvh-resident-tests.example",
} as const;
