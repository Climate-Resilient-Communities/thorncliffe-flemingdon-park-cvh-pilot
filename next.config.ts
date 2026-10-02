import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { LAUNCH_CODES } from "./src/i18n/languages";

const noStore = [{ key: "Cache-Control", value: "no-store" }];

const nextConfig: NextConfig = {
  env: {
    APP_VERSION: process.env.APP_VERSION ?? "dev",
  },
  async headers() {
    // AD-1: nothing on the staff surface may be stored by a browser or a cache.
    return [
      { source: "/staff/:path*", headers: noStore },
      { source: "/api/staff/:path*", headers: noStore },
      // S02.08 / NFR-N7: a building page is public and the same for everyone, so a shared cache may keep it for five
      // minutes and serve it for one minute more while it fetches a fresh copy (s-maxage=300 + stale-while-revalidate=60).
      // When the Hub saves a contact, the app's own cache drops the building at once, so a change then reaches every
      // resident within about 6 minutes: the time a shared cache may still hold the old page. (A change to the register's
      // facts is not dropped by the app; it can wait for the app's 5-minute data cache first.) The header also reaches
      // the 404 of a building that is not there yet, which is kept for the same time.
      // The language is pinned to the launch codes: an open `:lang` would also match /staff/buildings/x and
      // /api/buildings/x, and this rule comes after the staff no-store rules, so it would win over them.
      { source: `/:lang(${LAUNCH_CODES.join("|")})/buildings/:rsn`, headers: [{ key: "Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=60" }] },
    ];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
