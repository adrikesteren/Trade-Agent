import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProposedOrder } from "@repo/risk";

type RowPosition = {
  quantity: number;
  avg_price: number | null;
};

/**
 * Paper fill at `price`: creates filled order + fill row and updates `positions`.
 * Uses service-role client (RLS bypass); caller must enforce `userId`/`connectorId` from trusted jobs.
 */
export async function executePaperOrder(params: {
  supabase: SupabaseClient;
  userId: string;
  connectorId: string;
  decisionId: string;
  proposed: ProposedOrder;
  price: number;
}): Promise<{ orderId: string }> {
  const { supabase, userId, connectorId, decisionId, proposed, price } = params;
  if (price <= 0 || !Number.isFinite(price)) {
    throw new Error("executePaperOrder: invalid price");
  }

  const quantity =
    proposed.side === "buy"
      ? proposed.notionalEur / price
      : Math.min(Math.abs(proposed.notionalEur / price), Number.MAX_SAFE_INTEGER);

  const { data: orderRow, error: orderErr } = await supabase
    .from("orders")
    .insert({
      user_id: userId,
      connector_id: connectorId,
      decision_id: decisionId,
      side: proposed.side,
      symbol: proposed.symbol,
      quantity,
      status: "filled",
      paper: true,
    })
    .select("id")
    .single();

  if (orderErr || !orderRow) {
    throw new Error(orderErr?.message ?? "order insert failed");
  }

  const orderId = orderRow.id as string;

  const { error: fillErr } = await supabase.from("fills").insert({
    user_id: userId,
    order_id: orderId,
    price,
    quantity,
    fee: 0,
  });
  if (fillErr) throw new Error(fillErr.message);

  const { data: existing } = await supabase
    .from("positions")
    .select("quantity, avg_price")
    .eq("user_id", userId)
    .eq("connector_id", connectorId)
    .eq("symbol", proposed.symbol)
    .eq("paper", true)
    .maybeSingle();

  const prev = (existing as RowPosition | null) ?? { quantity: 0, avg_price: null };
  let newQty = prev.quantity;
  let newAvg = prev.avg_price;

  if (proposed.side === "buy") {
    const totalCost = (prev.avg_price ?? 0) * prev.quantity + price * quantity;
    newQty = prev.quantity + quantity;
    newAvg = newQty > 0 ? totalCost / newQty : price;
  } else {
    newQty = prev.quantity - quantity;
    newAvg = newQty <= 0 ? null : prev.avg_price;
  }

  const { error: posErr } = await supabase.from("positions").upsert(
    {
      user_id: userId,
      connector_id: connectorId,
      symbol: proposed.symbol,
      quantity: newQty,
      avg_price: newAvg,
      paper: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,connector_id,symbol,paper" },
  );

  if (posErr) throw new Error(posErr.message);

  return { orderId };
}
