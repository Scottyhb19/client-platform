# Deferred prompts

A working file of tracked-but-not-yet-resolved scope and design decisions. **Not a contract.** Items here are still under consideration; some will be promoted into a phase plan or closed without action.

When an item is closed:
- If it landed in the codebase, link the commit / PR and remove the entry (the change itself is the record).
- If it was rejected, leave a one-line note here so the decision isn't relitigated.

When an item lands as a phase plan, link the relevant section in `docs/polish/<section>.md` and remove the duplicate detail from this file.

---

## Testing module — practice_custom_metrics (metric-on-existing-test)

**Surfaced:** 2026-05-01 during D.2 polish (negative-value bug + missing path to attach a metric to an existing test like CMJ).

**Problem.** The custom-test builder at Settings → Tests → Custom tests creates whole new tests. There's no path for the EP to add a metric *inside* an existing schema test. Workaround today: create a one-metric custom test for the new metric — but that produces a separate tile in the Reports tab when the metric should sit beside the parent test's other metrics.

**Decisions taken (signed off, not yet implemented):**

| Choice | Decision |
|---|---|
| Architecture | New `practice_custom_metrics` table keyed on `(organization_id, test_id, metric_id)`. `test_id` may point to a schema test (`cmj`) OR a custom test (`custom_xxx`). Resolver and catalog loader merge at read time. |
| UI placement | Mode toggle inside the existing Custom Tests section: "Create new test" vs "Add metric to existing test". Same metric form, different first step. |
| Existing data | User will manually delete the standalone "Eccentric peak velocity" custom test and recreate the metric inside CMJ via the new flow once it lands. No in-place migration tool needed. |
| Scope/sequencing | Bundled after Phase D.4 (publish flow) lands. Hotfix for the negative-value bug shipped first as D.2.1. |

**Implementation outline (when it lands):**

1. Migration — `practice_custom_metrics` table, RLS (same shape as `practice_custom_tests`), unique `(organization_id, test_id, metric_id) WHERE deleted_at IS NULL`, FK soft-delete cascading via the existing audit trigger pattern.
2. Audit register — add to `audit_resolve_org_id()` CASE list (per project memory `audit_register_new_tables`).
3. Soft-delete RPC — `soft_delete_practice_custom_metric` (matches existing pattern in migration `20260429120000`).
4. Resolver — `resolveMetricSettings` and `resolveMetricSettingsBulk` walk: schema seed OR custom test (existing), THEN check `practice_custom_metrics` for an org-level addition keyed on the same (test_id, metric_id). Custom metrics on schema tests use the schema test's labels (category, subcategory, test_name) but their own metric label/unit/hints.
5. Catalog loader — `loadCatalog` joins `practice_custom_metrics` and appends to the appropriate test's metric array.
6. Custom-test builder UI — toggle at top of the section. "Add metric" mode shows a parent-test picker (search across schema + custom tests, force-expand on filter, same UX as the saved-batteries picker), then the metric form below.
7. Test history loader — `loadTestHistoryForClient` already groups by test_id; custom-on-existing metrics will appear inside the parent test card automatically once the resolver returns the right test_name.
8. pgTAP — extend `01_visibility_override.sql` (or new test) to assert custom metrics on a schema test_id resolve correctly and inherit RLS visibility from the parent test.

**Why deferred:**
- D.2 polish-pass scope: ship the IA + charts + publish flow before adding new authoring surfaces.
- The negative-value blocker is unblocked by the D.2.1 fallback hotfix; the architectural change isn't urgent.
- Pre-launch advantage: schema migration cost is still low when this lands. No reason to rush.

---
