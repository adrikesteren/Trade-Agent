import { describe, expect, it } from "vitest";

import { executorAllowsMarketAsset } from "./executor-rules.service";

describe("executorAllowsMarketAsset", () => {
  const btc = "00000000-0000-0000-0000-000000000001";
  const eth = "00000000-0000-0000-0000-000000000002";

  it("allows all when mode is all", () => {
    expect(executorAllowsMarketAsset({ asset_filter_mode: "all", filter_asset_ids: [] }, btc)).toBe(true);
  });

  it("whitelist requires membership", () => {
    expect(
      executorAllowsMarketAsset({ asset_filter_mode: "whitelist", filter_asset_ids: [btc] }, btc),
    ).toBe(true);
    expect(
      executorAllowsMarketAsset({ asset_filter_mode: "whitelist", filter_asset_ids: [btc] }, eth),
    ).toBe(false);
  });

  it("blacklist excludes members", () => {
    expect(
      executorAllowsMarketAsset({ asset_filter_mode: "blacklist", filter_asset_ids: [btc] }, btc),
    ).toBe(false);
    expect(
      executorAllowsMarketAsset({ asset_filter_mode: "blacklist", filter_asset_ids: [btc] }, eth),
    ).toBe(true);
  });

  it("rejects unknown asset when filtered", () => {
    expect(executorAllowsMarketAsset({ asset_filter_mode: "whitelist", filter_asset_ids: [btc] }, null)).toBe(
      false,
    );
  });
});
