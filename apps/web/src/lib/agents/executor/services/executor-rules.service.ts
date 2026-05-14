export type ExecutionMode = "paper" | "live" | "historical";
export type ExecutorAssetFilterMode = "all" | "whitelist" | "blacklist";

export type ExecutorFilterInput = {
  asset_filter_mode: ExecutorAssetFilterMode;
  filter_asset_ids: string[] | null | undefined;
};

/** When filter mode is not `all`, require a non-empty asset id set (DB enforces too). */
export function executorAllowsMarketAsset(
  ex: ExecutorFilterInput,
  marketAssetId: string | null | undefined,
): boolean {
  const mode = ex.asset_filter_mode ?? "all";
  const ids = (ex.filter_asset_ids ?? []).filter(Boolean);
  if (mode === "all") return true;
  if (!marketAssetId) return false;
  if (mode === "whitelist") return ids.includes(marketAssetId);
  if (mode === "blacklist") return !ids.includes(marketAssetId);
  return false;
}
