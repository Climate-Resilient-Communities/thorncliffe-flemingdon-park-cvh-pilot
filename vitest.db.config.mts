import { defineConfig } from "vitest/config";

// Database tests (S01.03): they need a disposable PostgreSQL server with
// Supabase's extensions, given as TEST_DATABASE_URL (see test/db/helpers.ts).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["test/db/**/*.db.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
