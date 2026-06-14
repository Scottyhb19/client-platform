import { SessionThemeRoot } from './SessionThemeRoot'

/**
 * Layout for the in-session route segment — wraps the logger
 * (page.tsx), the completion summary (complete/page.tsx), and the
 * error/fallback states in the themed `.session-screen` container so the
 * whole in-session flow shares one dark (default) / light surface.
 * Section 7 / P1-1.
 */
export default function SessionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <SessionThemeRoot>{children}</SessionThemeRoot>
}
