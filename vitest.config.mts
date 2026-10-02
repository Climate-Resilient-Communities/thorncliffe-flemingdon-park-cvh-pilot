import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
    environment: "node",
    // next-intl's middleware imports "next/server" without an extension, which Node's ESM resolution refuses.
    server: { deps: { inline: ["next-intl"] } },
  },
});
