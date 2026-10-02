import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

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
      // S02.08 / NFR-N7: a building page is public and the same for everyone, so a shared cache may keep it for
      // five minutes (the same time as its data cache). The header also reaches the 404 of a building that is not
      // there yet, which is then also kept for at most those five minutes.
      { source: "/:lang/buildings/:rsn", headers: [{ key: "Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=3600" }] },
    ];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
