import { createSerwistRoute } from "@serwist/turbopack";

// The service worker (S02.12), built from src/app/sw.ts by Serwist with esbuild when the app is built, and served at
// /serwist/sw.js with `Service-Worker-Allowed: /` so its scope is the whole origin. The precache list is the build's
// scripts and styles and the icons; fonts are kept as pages use them (they are large, and a phone needs one script's).
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
  globPatterns: [".next/static/**/*.{js,css}", "public/brand/*.png", "public/icons/*.png"],
  // The precache list must not carry the source map or anything a build writes outside the client bundle.
  globIgnores: ["**/*.map"],
});
