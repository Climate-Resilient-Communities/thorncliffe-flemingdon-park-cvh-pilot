import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database tests (S01.03): they need a disposable PostgreSQL server with
// Supabase's extensions, given as TEST_DATABASE_URL (see test/db/helpers.ts).
export default defineConfig({
  // `import "server-only"` throws outside React's server condition; under test the module is an empty stub.
  resolve: { tsconfigPaths: true, alias: { "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)) } },
  test: {
    include: ["test/db/**/*.db.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
