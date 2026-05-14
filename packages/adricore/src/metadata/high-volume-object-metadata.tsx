import { ObjectMetadataBase } from "./object-metadata-base";

/**
 * Object metadata for high-volume / append-only tables (logs, candles,
 * signal_jobs, signal_runs, schedule_runs, sync_runs, wallet_transactions,
 * fills, executor_moving_floors, executor_historical_runs, ...).
 *
 * Inherits the standard audit field set (`id`, `created_by`, `created_at`,
 * `updated_by`, `updated_at`) from {@link ObjectMetadataBase} but **does not**
 * add a `name` column or {@link NameFieldSpec}: the storage overhead of a text
 * column on tables that can grow to millions of rows is not worth the marginal
 * UX win. `getRecordTitle` falls back to the id.
 */
export abstract class HighVolumeObjectMetadata extends ObjectMetadataBase {
  public readonly isHighVolume = true as const;
}
