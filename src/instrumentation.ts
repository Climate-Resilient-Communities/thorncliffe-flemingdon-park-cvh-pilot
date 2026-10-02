// Runs once when each Node.js server instance starts (next start, next dev, and every Vercel
// function cold start); not during `next build`, whose environment may differ from the runtime's,
// and not in the edge runtime (no edge code reads the environment schema). An unsafe environment
// is logged (getEnv names the failed rules, never secret values) and the process exits, so the
// server does not keep running and answering 500. Local runs need SMS_MODE=log and
// PUBLIC_BASE_URL=http://localhost:3000 (for example in .env.local); the smoke check sets them.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { checkEnvAtStartup } = await import("./platform/config/env");
  checkEnvAtStartup();
}
