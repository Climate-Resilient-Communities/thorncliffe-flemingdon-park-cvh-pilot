import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `import "server-only"` throws outside React's server condition; under test the module is an empty stub (Next does the same in a server build).
  resolve: { tsconfigPaths: true, alias: { "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
    // Database tests run separately against a disposable server (npm run test:db).
    exclude: ["test/db/**", "**/node_modules/**"],
    environment: "node",
    // next-intl's middleware imports "next/server" without an extension, which Node's ESM resolution refuses.
    server: { deps: { inline: ["next-intl"] } },
  },
});
