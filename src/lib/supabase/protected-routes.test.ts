import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { STAFF_ROUTE_PREFIXES } from './protected-routes'

// G-15 maintenance coupling, machine-checked (2026-07-23 sign-off review:
// "a REGISTRATION RULE comment is not a mitigation; it's a note"). The
// middleware's staff prefix list must equal the actual route-directory set
// under src/app/(staff)/ — both directions:
//   * a directory missing from the list = the G-15 hole reopened (that
//     route's logged-out deep links silently drop their destination)
//   * a listed prefix with no directory = a stale entry gating a path that
//     no longer exists
describe('STAFF_ROUTE_PREFIXES ↔ src/app/(staff) coupling', () => {
  it('equals the (staff) route-directory set exactly', () => {
    const staffDir = join(process.cwd(), 'src', 'app', '(staff)')
    const routeDirs = readdirSync(staffDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      // _-prefixed folders (e.g. _components) are Next private folders, not
      // routes; (group) folders would need their children listed instead —
      // fail loudly if one ever appears rather than guessing.
      .filter((e) => !e.name.startsWith('_'))
      .map((e) => e.name)

    const nestedGroups = routeDirs.filter((n) => n.startsWith('('))
    expect(
      nestedGroups,
      'nested route group under (staff) — extend this test before using one',
    ).toEqual([])

    const fromDisk = routeDirs.map((n) => `/${n}`).sort()
    const fromList = [...STAFF_ROUTE_PREFIXES].sort()
    expect(fromList).toEqual(fromDisk)
  })
})
