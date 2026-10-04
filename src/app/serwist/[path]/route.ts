import path from "node:path";
import { createSerwistRoute } from "@serwist/turbopack";
import { precacheFilter } from "@/app/offline/precache";

// The service worker (S02.12), built from src/app/sw.ts by Serwist with esbuild when the app is built, and served at
// /serwist/sw.js with `Service-Worker-Allowed: /` so its scope is the whole origin. The precache list is the build's
// scripts and styles the resident pages load (offline/precache.ts reads them from the build) and the icons: not the Hub's,
// which a phone would download and never use. Fonts are kept as pages use them (they are large).
// The build folder: next.config.ts sets no distDir, and the glob below names the same folder.
const DIST_DIR = ".next";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
  globPatterns: [".next/static/**/*.{js,css}", "public/brand/*.png", "public/icons/*.png"],
  // The precache list must not carry the source map or anything a build writes outside the client bundle.
  globIgnores: ["**/*.map"],
  manifestTransforms: [
    async (entries) => {
      const { keeps, warnings } = precacheFilter(path.join(process.cwd(), DIST_DIR));
      return { manifest: entries.filter((entry) => keeps(entry.url)), warnings };
    },
  ],
});
