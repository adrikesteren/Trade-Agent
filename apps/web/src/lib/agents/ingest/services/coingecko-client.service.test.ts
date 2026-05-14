import { describe, expect, it } from "vitest";

import {
  type CoinGeckoSearchCoin,
  resolveCoinGeckoIdFromSearchCoins,
} from "@/lib/agents/ingest/services/coingecko-client.service";

const coin = (id: string, name: string, symbol: string, rank?: number | null): CoinGeckoSearchCoin => ({
  id,
  name,
  symbol,
  market_cap_rank: rank ?? null,
});

describe("resolveCoinGeckoIdFromSearchCoins", () => {
  it("returns the only symbol match", () => {
    const coins = [coin("bitcoin", "Bitcoin", "BTC", 1), coin("ethereum", "Ethereum", "ETH", 2)];
    expect(resolveCoinGeckoIdFromSearchCoins(coins, "BTC", "Bitcoin")).toBe("bitcoin");
  });

  it("disambiguates multiple symbol matches by exact name (case-insensitive)", () => {
    const coins = [
      coin("test-a", "Alpha BTC Fork", "BTC", 900),
      coin("test-b", "Bitcoin", "BTC", 1),
    ];
    expect(resolveCoinGeckoIdFromSearchCoins(coins, "BTC", "Bitcoin")).toBe("test-b");
    expect(resolveCoinGeckoIdFromSearchCoins(coins, "BTC", "alpha btc fork")).toBe("test-a");
  });

  it("returns null when multiple symbol matches and no asset name", () => {
    const coins = [coin("a", "A", "XYZ", 1), coin("b", "B", "XYZ", 2)];
    expect(resolveCoinGeckoIdFromSearchCoins(coins, "XYZ", null)).toBeNull();
    expect(resolveCoinGeckoIdFromSearchCoins(coins, "XYZ", "   ")).toBeNull();
  });

  it("returns null when name does not uniquely match", () => {
    const coins = [coin("a", "Same", "ABC", 1), coin("b", "Same", "ABC", 2)];
    expect(resolveCoinGeckoIdFromSearchCoins(coins, "ABC", "Same")).toBeNull();
  });

  it("returns null when no symbol match", () => {
    expect(resolveCoinGeckoIdFromSearchCoins([coin("eth", "Ethereum", "ETH")], "BTC", "Bitcoin")).toBeNull();
  });
});
