import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// JS unit-test tier — pure logic only (no React/Next/jsdom), so it stays fast
// and never loads a component's module graph. DB behaviour is covered by pgTAP
// (supabase/tests) and UI by the operator browser pass; this tier exists for
// extracted pure functions like removalActionForAppointment (RO-6). Tests may
// exercise thin server modules (e.g. logAuthEvent, B-4) ONLY with every
// framework import vi.mock'd by factory, so nothing of Next's graph loads.
export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" → "src/*" so mocked-module specifiers resolve.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
  },
})
