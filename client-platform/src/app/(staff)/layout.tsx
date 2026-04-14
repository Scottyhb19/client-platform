import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { StaffNav } from "@/components/layout/staff-nav";

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r border-[var(--color-border)] bg-white">
        {/* Logo / Brand */}
        <div className="flex h-16 items-center gap-2 border-b border-[var(--color-border)] px-5">
          <div className="h-8 w-8 rounded-lg bg-[var(--color-primary)] flex items-center justify-center">
            <span className="text-sm font-bold text-white font-[family-name:var(--font-display)]">
              CP
            </span>
          </div>
          <span className="text-lg font-semibold text-[var(--color-charcoal)] font-[family-name:var(--font-display)]">
            Client Platform
          </span>
        </div>

        {/* Navigation */}
        <StaffNav />

        {/* User section */}
        <div className="mt-auto border-t border-[var(--color-border)] p-4">
          <UserButton
            appearance={{
              variables: { colorPrimary: "#0A5540" },
            }}
          />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
