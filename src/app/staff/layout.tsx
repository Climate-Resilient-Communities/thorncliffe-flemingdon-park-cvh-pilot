import "../globals.css";

// Staff screens are per-user, so none is prerendered: no copy of a staff page
// ever sits in a CDN cache. The no-store header itself is set in next.config.ts (AD-1).
export const dynamic = "force-dynamic";

// A root layout of its own: the staff <html> is English, and a resident page's carries its language.
export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
