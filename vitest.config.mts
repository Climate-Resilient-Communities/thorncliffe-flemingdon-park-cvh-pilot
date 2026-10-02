import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
    // Database tests run separately against a disposable server (npm run test:db).
    exclude: ["test/db/**", "**/node_modules/**"],
    environment: "node",
    // next-intl's middleware imports "next/server" without an extension, which Node's ESM resolution refuses.
    server: { deps: { inline: ["next-intl"] } },
  },
});
