// Runs once when the server starts (not during `next build`). On Vercel (VERCEL_ENV is set) an
// unsafe environment stops the server from starting. Without VERCEL_ENV (local `next dev`, the CI
// smoke check of the production build) nothing is checked here; getEnv() checks on first use.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!process.env.VERCEL_ENV) return;
  const { getEnv } = await import("./platform/config/env");
  getEnv();
}
