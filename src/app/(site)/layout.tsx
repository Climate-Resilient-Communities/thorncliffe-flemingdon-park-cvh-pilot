import type { Metadata } from "next";
import "../globals.css";

// Each surface has its own root layout, because a resident page's <html> carries its language and direction
// (src/app/[lang]/layout.tsx) and the staff surface's does not.
export const metadata: Metadata = {
  title: "Community Virtual Hub",
};

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
