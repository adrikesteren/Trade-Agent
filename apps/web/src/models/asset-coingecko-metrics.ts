import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class AssetCoingeckoMetricsModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "asset_coingecko_metrics",
      "asset_coingecko_metrics",
      new ObjectLabelMetadata("Asset CoinGecko Metric", "Asset CoinGecko Metrics")
    );
  }
}
