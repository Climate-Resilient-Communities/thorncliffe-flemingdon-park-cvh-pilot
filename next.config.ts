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
    ];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
