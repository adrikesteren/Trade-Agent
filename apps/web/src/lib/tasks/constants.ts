/** Worker-created task when CoinGecko /search cannot pick a unique coin id for an asset. */
export const TASK_TYPE_REQUIRES_MANUAL_COINGECKO_SEARCH = "requires_manual_coingecko_search";

/**
 * When an open task with this job identifier exists for an asset, `syncCoingeckoCoinIds` skips
 * automatic /search for that asset (operator silence).
 */
export const JOB_IDENTIFIER_SKIP_AUTO_COINGECKO_COIN_ID = "skip_auto_coingecko_coin_id";
