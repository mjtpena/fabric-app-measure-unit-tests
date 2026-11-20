/** Rules and thresholds. The About page shows these values, so keep the wording in step. */

/** Display label of the bound semantic model (the connector named `model` in rayfin.yml). */
export const MODEL_LABEL = 'X10 Retail Demo Model';

export const RUN_RULES = {
  /** Cases run at the same time. */
  concurrency: 2,
  /** Per-case timeout. */
  timeoutMs: 30_000,
  /** Rows shown in a result preview. */
  maxDisplayRows: 100,
  /** Row cap sent with scalar, notblank and between queries (only the first cell is read). */
  queryRowLimit: 1_000,
  /** Row cap sent with rowcount queries. Above it the case errors with category "overflow". */
  rowcountRowLimit: 50_000,
  /** Absolute tolerance used for numeric comparisons when a case sets none (floating-point noise). */
  defaultTolerance: 0.000001,
  /** Runs shown on the History chart. */
  historyRuns: 30,
  /** A run still "running" after this long was interrupted (tab closed mid-run). */
  staleRunMs: 10 * 60_000,
  /** Poll interval for a run someone else is executing. */
  pollMs: 5_000,
} as const;

/** Latency of the offline mock model per query, so run progress is visible in demo mode. */
export const MOCK_LATENCY_MS = 450;
