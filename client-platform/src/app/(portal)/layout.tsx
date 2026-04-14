import { PortalNav } from "@/components/layout/portal-nav";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      {/* Main content — scrollable, fills space above bottom nav */}
      <main className="flex-1 overflow-y-auto pb-20">{children}</main>

      {/* Bottom navigation — fixed, thumb-friendly */}
      <PortalNav />
    </div>
  );
}
