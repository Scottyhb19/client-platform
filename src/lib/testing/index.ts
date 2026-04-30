/**
 * Public API for the testing-module runtime config layer.
 *
 * Per /docs/testing-module-schema.md §0, application code MUST go
 * through `resolveMetricSettings` to read rendering hints. Direct
 * SELECTs against practice_test_settings, physical_markers_schema_seed,
 * or the schema JSON file from elsewhere in the codebase are a violation
 * of the runtime-config rule.
 */

export { resolveMetricSettings, resolveMetricSettingsBulk } from './resolver'
export {
  loadSchemaFile,
  getSchemaFileVersion,
  loadSchemaSeed,
  assertSchemaConsistent,
} from './schema-loader'
export {
  getMetricBounds,
  validateMetricValue,
  type ValidationVerdict,
} from './validation-bounds'
export {
  loadCatalog,
  loadActiveBatteries,
  loadAllBatteriesForOrg,
  loadLastUsedBatteryForClient,
  loadCapturedSessionsForClient,
  loadTestHistoryForClient,
  loadAllOverridesForOrg,
  loadAllDisabledTests,
  loadCustomTestsForOrg,
  type CatalogCategory,
  type CatalogSubcategory,
  type CatalogTest,
  type CatalogMetric,
  type BatteryRow,
  type EditableBatteryRow,
  type LastUsedBatteryHint,
  type CapturedSessionRow,
  type ClientTestHistory,
  type TestHistory,
  type MetricHistory,
  type MetricSeriesPoint,
  type CategorySummary,
  type OverrideMapEntry,
  type PracticeCustomTest,
} from './loaders'
export type {
  ClientPortalVisibility,
  ClientViewChart,
  ComparisonMode,
  DefaultChart,
  DirectionOfGood,
  InputType,
  MetricKey,
  MetricLabels,
  MetricMeasurement,
  MetricRenderingHints,
  ResolvedMetricSettings,
  SchemaSeedRow,
  Side,
} from './types'
export {
  DIRECTION_TOKENS,
  verdictFor,
  colourFor,
  formatPctChange,
  formatDelta,
  type DirectionVerdict,
} from './direction'
