import {
  ExecutorForm,
  type AssetOption,
  type ExchangeOption,
  type ExecutorFormInitial,
  type ExecutorQuoteBudgetInitial,
} from "@/app/(app)/executors/executor-form";
import { executorRowToFormInitial } from "@/app/(app)/executors/executor-row-to-form-initial";
import { fetchQuoteAssetOptionsByExchange } from "@/app/(app)/executors/quote-asset-options";
import { fetchExchangeCapabilitiesById } from "@/app/(app)/executors/exchange-capabilities";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Alert, Stack } from "@repo/adricore/blocks";
import Link from "next/link";
import { redirect } from "next/navigation";

async function fetchAssetOptions(supabase: SupabaseClient): Promise<AssetOption[]> {
  const { data, error } = await supabase
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .eq("kind", "crypto")
    .order("code", { ascending: true })
    .limit(400);
  if (error) {
    console.error("assets list:", error.message);
    return [];
  }
  return ((data ?? []) as { id: string; code: string }[]).map((a) => ({ id: a.id, code: a.code }));
}

async function fetchExchangeOptions(supabase: SupabaseClient): Promise<ExchangeOption[]> {
  const { data, error } = await supabase.schema("catalog").from("exchanges").select("id, code, name").order("code");
  if (error) {
    console.error("exchange list:", error.message);
    return [];
  }
  return ((data ?? []) as { id: string; code: string; name: string }[]).map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
  }));
}

function parseCloneFromParam(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return String(raw[0] ?? "").trim();
  return String(raw ?? "").trim();
}

type NewExecutorPageProps = {
  searchParams?: Promise<{ from?: string | string[] }>;
};

export default async function NewExecutorPage({ searchParams }: NewExecutorPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sp = (await searchParams) ?? {};
  const cloneFromId = parseCloneFromParam(sp.from);

  const [assetOptions, exchangeOptions, quoteAssetOptionsByExchange, exchangeCapabilitiesById, prefs, cloneRow] =
    await Promise.all([
      fetchAssetOptions(supabase),
      fetchExchangeOptions(supabase),
      fetchQuoteAssetOptionsByExchange(supabase),
      fetchExchangeCapabilitiesById(supabase),
      getUserLocalePreferences(),
      cloneFromId
        ? supabase
            .schema("trading")
            .from("executors")
            .select(
              "id, name, enabled, exchange_id, execution_mode, asset_filter_mode, filter_asset_ids, allowed_sides, max_risk_per_trade, max_open_positions, max_exposure_per_symbol_eur, daily_loss_limit_eur, max_drawdown_eur, cooldown_after_losses, allow_add, mediator_rails_extra, profit_taking_enabled, moving_floor_trail_pct, moving_floor_activation_profit_pct, moving_floor_timeframe, slack_trade_notifications_enabled, exchange_api_key, exchange_api_secret, historical_start_date, historical_end_date",
            )
            .eq("id", cloneFromId)
            .eq("user_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null as { message: string } | null }),
    ]);

  let cloneInitial: ExecutorFormInitial | undefined;
  let cloneSourceName: string | undefined;
  let cloneError: string | null = null;

  if (cloneFromId) {
    if (cloneRow.error) {
      cloneError = cloneRow.error.message;
    } else if (!cloneRow.data) {
      cloneError = "Executor not found or you do not have access.";
    } else {
      const row = cloneRow.data;
      cloneSourceName = String(row.name ?? "").trim() || "Executor";
      const base = cloneSourceName;
      const copyName = base ? `${base} (copy)` : "Executor (copy)";

      // Clone the source executor's quote-asset budget rows so the new form starts pre-populated.
      const { data: cloneBudgets } = await supabase
        .schema("trading")
        .from("executor_quote_asset_budget")
        .select("quote_asset_id, max_notional_primary")
        .eq("executor_id", cloneFromId)
        .order("created_at", { ascending: true });
      const quoteBudgets: ExecutorQuoteBudgetInitial[] = ((cloneBudgets ?? []) as {
        quote_asset_id: string;
        max_notional_primary: string | number;
      }[]).map((b) => ({
        quote_asset_id: b.quote_asset_id,
        max_notional_primary: String(b.max_notional_primary ?? ""),
      }));

      cloneInitial = executorRowToFormInitial(row, { nameOverride: copyName, quoteBudgets });
    }
  }

  const title = cloneInitial ? "Clone executor" : "New executor";
  const subtitle = cloneInitial
    ? `Settings copied from "${cloneSourceName ?? "executor"}". Exchange API keys are not copied — use paper mode or enter new keys for live. Balance and related records stay on the original.`
    : "Create a portfolio with its own paper/live mode, optional asset whitelist or blacklist, then add EUR balance on the executor detail page.";

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <div>
        <h1 className="bk-page-header_title">{title}</h1>
        <p className="bk-page-header_subtitle">{subtitle}</p>
      </div>
      <Stack gap="md">
        <p className="bk-text-muted text-sm">
          <Link href="/executors" className="bk-link">
            Back to executors
          </Link>
        </p>
        {cloneError ? <Alert tone="error">{cloneError}</Alert> : null}
        {assetOptions.length === 0 ? (
          <Alert tone="warning">No catalog assets loaded yet; asset filters will be empty until assets exist.</Alert>
        ) : null}
        <ExecutorForm
          mode="create"
          assetOptions={assetOptions}
          exchangeOptions={exchangeOptions}
          quoteAssetOptionsByExchange={quoteAssetOptionsByExchange}
          exchangeCapabilitiesById={exchangeCapabilitiesById}
          primaryAssetCode={prefs.primary_asset?.code ?? "EUR"}
          initial={cloneInitial}
        />
      </Stack>
    </div>
  );
}
