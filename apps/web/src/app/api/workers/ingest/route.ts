import { NextResponse } from "next/server";

/**
 * Legacy ingest (candles → signals → mediator → paper orders) is disabled.
 * Database tables for that pipeline were removed; reintroduce deliberately when you design that step.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "ingest_disabled",
      hint: "Trading/mediator ingest was removed. Use catalog sync (Bitvavo markets/candles, CoinGecko metrics) until a new pipeline exists.",
    },
    { status: 501 },
  );
}
