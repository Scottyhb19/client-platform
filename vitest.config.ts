import { defineConfig } from 'vitest/config'

// JS unit-test tier — pure logic only (no React/Next/jsdom), so it stays fast
// and never loads a component's module graph. DB behaviour is covered by pgTAP
// (supabase/tests) and UI by the operator browser pass; this tier exists for
// extracted pure functions like removalActionForAppointment (RO-6).
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
  },
})
