// Staff screens are per-user, so none is prerendered: no copy of a staff page
// ever sits in a CDN cache. The no-store header itself is set in next.config.ts (AD-1).
export const dynamic = "force-dynamic";

export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  return children;
}
