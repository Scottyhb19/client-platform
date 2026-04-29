/**
 * Slug helpers for the custom-test builder. Per Q2 sign-off, the client
 * auto-slugifies the test name and metric labels into ids; the server
 * validates against the DB CHECK regexes but does not slugify itself.
 *
 * Slug rules:
 * - Lowercase
 * - Replace any run of non-[a-z0-9] with a single underscore
 * - Trim leading and trailing underscores
 * - For test_id: prefix `custom_` and cap the post-prefix part at 73 chars
 *   (DB CHECK allows custom_ + up to 73 chars = 80 total)
 * - For metric_id: cap at 80 chars
 *
 * On collision: append `_2`, `_3`, … until unique.
 */

const TEST_ID_PREFIX = 'custom_'
const TEST_ID_BODY_MAX = 73
const METRIC_ID_MAX = 80

function slugifyCore(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Slugify a test name into a `custom_…` id, deduplicated against
 * existing test ids in the org.
 *
 * "ACL Phase 2 reassessment" → "custom_acl_phase_2_reassessment"
 * If the user has another `custom_acl_phase_2_reassessment` already,
 * returns `custom_acl_phase_2_reassessment_2`.
 */
export function slugifyTestId(name: string, existing: ReadonlySet<string>): string {
  const core = slugifyCore(name).slice(0, TEST_ID_BODY_MAX)
  const baseBody = core.length > 0 ? core : 'test'
  let candidate = `${TEST_ID_PREFIX}${baseBody}`
  if (!existing.has(candidate)) return candidate
  // Append _2, _3, ... — also subject to the 73-char body cap.
  for (let n = 2; n < 1000; n++) {
    const suffix = `_${n}`
    const truncated = baseBody.slice(0, TEST_ID_BODY_MAX - suffix.length)
    candidate = `${TEST_ID_PREFIX}${truncated}${suffix}`
    if (!existing.has(candidate)) return candidate
  }
  // Practically unreachable — fall back to a timestamp tail.
  return `${TEST_ID_PREFIX}${baseBody.slice(0, TEST_ID_BODY_MAX - 7)}_${Date.now().toString(36).slice(-6)}`
}

/**
 * Slugify a metric label into a metric_id, deduplicated against existing
 * metric ids in the same test.
 *
 * "Peak force" → "peak_force"
 * "Peak force" again → "peak_force_2"
 */
export function slugifyMetricId(label: string, existing: ReadonlySet<string>): string {
  const core = slugifyCore(label).slice(0, METRIC_ID_MAX)
  const base = core.length > 0 ? core : 'metric'
  let candidate = base
  if (!existing.has(candidate)) return candidate
  for (let n = 2; n < 1000; n++) {
    const suffix = `_${n}`
    const truncated = base.slice(0, METRIC_ID_MAX - suffix.length)
    candidate = `${truncated}${suffix}`
    if (!existing.has(candidate)) return candidate
  }
  return `${base.slice(0, METRIC_ID_MAX - 7)}_${Date.now().toString(36).slice(-6)}`
}
