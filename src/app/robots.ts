import type { MetadataRoute } from "next";

/**
 * robots.txt (SIT of 2026-10-08, F3): the resident pages may be indexed; the staff surface and the API may not (they also answer
 * `X-Robots-Tag: noindex, nofollow`, next.config.ts). No sitemap is published.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/staff", "/api/"] } };
}
