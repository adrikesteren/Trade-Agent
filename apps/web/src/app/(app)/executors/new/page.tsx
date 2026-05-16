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
import * as AssetsSelector from "@/lib/selectors/assets-selector";
import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";
import * as ExecutorQuoteAssetBudgetSelector from "@/lib/selectors/executor-quote-asset-budget-selector";
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Alert, Stack } from "@adrikesteren/adricore/blocks";
import Link from "next/link";
import { redirect } from "next/navigation";

async function fetchAssetOptions(supabase: SupabaseClient): Promise<AssetOption[]> {
  let data: Awaited<ReturnType<typeof AssetsSelector.selectIdCodeByKindOrderedLimited>>;
  try {
    data = await AssetsSelector.selectIdCodeByKindOrderedLimited(supabase, "crypto", 400);
  } catch (e) {
    console.error("assets list:", e instanceof Error ? e.message : String(e));
    return [];
  }
  return data.map((a) => ({ id: a.id, code: a.code }));
}

async function fetchExchangeOptions(supabase: SupabaseClient): Promise<ExchangeOption[]> {
  let data: Awaited<ReturnType<typeof ExchangesSelector.selectAllOrderedByCode>>;
  try {
    data = await ExchangesSelector.selectAllOrderedByCode(supabase);
  } catch (e) {
    console.error("exchange list:", e instanceof Error ? e.message : String(e));
    return [];
  }
  return data.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name ?? "",
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

  const cloneRowPromise: Promise<{ data: ExecutorsSelector.ExecutorCloneRow | null; error: { message: string } | null }> =
    cloneFromId
      ? ExecutorsSelector.selectCloneByIdAndUser(supabase, { id: cloneFromId, userId: user.id })
          .then((data) => ({ data, error: null }))
          .catch((e: unknown) => ({
            data: null,
            error: { message: e instanceof Error ? e.message : String(e) },
          }))
      : Promise.resolve({ data: null, error: null });

  const [assetOptions, exchangeOptions, quoteAssetOptionsByExchange, exchangeCapabilitiesById, prefs, cloneRow] =
    await Promise.all([
      fetchAssetOptions(supabase),
      fetchExchangeOptions(supabase),
      fetchQuoteAssetOptionsByExchange(supabase),
      fetchExchangeCapabilitiesById(supabase),
      getUserLocalePreferences(),
      cloneRowPromise,
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
      let cloneBudgets: ExecutorQuoteAssetBudgetSelector.ExecutorQuoteBudgetCloneRow[] = [];
      try {
        cloneBudgets = await ExecutorQuoteAssetBudgetSelector.selectCloneByExecutorIdOrdered(
          supabase,
          cloneFromId,
        );
      } catch {
        /* preserve original soft-fail behavior — clone budgets stay empty */
      }
      const quoteBudgets: ExecutorQuoteBudgetInitial[] = cloneBudgets.map((b) => ({
        quote_asset_id: b.quote_asset_id,
        max_notional_primary: String(b.max_notional_primary ?? ""),
      }));

      cloneInitial = executorRowToFormInitial(row, { nameOverride: copyName, quoteBudgets });
    }
  }

  const title = cloneInitial ? "Clone executor" : "New executor";
  const subtitle = cloneInitial
    ? `Settings copied from "${cloneSourceName ?? "executor"}". Exchange API keys are not copied â€” use paper mode or enter new keys for live. Balance and related records stay on the original.`
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
