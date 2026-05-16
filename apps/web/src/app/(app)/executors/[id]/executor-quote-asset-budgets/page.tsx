import { ExecutorQuoteBudgetCreateDialog } from "@/app/(app)/executors/[id]/executor-quote-budget-create-dialog";
import { ExecutorQuoteBudgetDeleteDialog } from "@/app/(app)/executors/[id]/executor-quote-budget-delete-dialog";
import { ExecutorQuoteBudgetEditDialog } from "@/app/(app)/executors/[id]/executor-quote-budget-edit-dialog";
import { fetchQuoteAssetOptionsByExchange } from "@/app/(app)/executors/quote-asset-options";
import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { formatDatetime, formatDecimal } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
import * as AssetsSelector from "@/lib/selectors/assets-selector";
import { createClient } from "@/lib/supabase/server";
import {
  Alert,
  Card,
  CardBody,
  ListViewLayout,
  Table,
  TableWrap,
  Td,
  Th,
} from "@adrikesteren/adricore/blocks";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

type BudgetRow = {
  id: string;
  quote_asset_id: string;
  max_notional_primary: string | number;
  created_at: string;
  updated_at: string;
};

/**
 * View-all of every `trading.executor_quote_asset_budget` row for this executor.
 *
 * Renders per-row Edit/Delete dialogs and a New action in the header. Available
 * quote-asset options for the New dialog are filtered to ones that exist on
 * this executor's exchange AND don't already have a budget row.
 */
export default async function ExecutorQuoteAssetBudgetsRelatedPage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const prefs = await getUserLocalePreferences();
  const primaryCode = prefs.primary_asset?.code ?? "EUR";
  const fmtAmount = (v: string | number | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDt = (v: string | number | Date | null) =>
    v == null || v === "" ? "—" : formatDatetime(v, prefs);

  const { data: ex, error: exErr } = await supabase
    .schema("trading")
    .from("executors")
    .select("id, name, exchange_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (exErr || !ex) notFound();
  const executorName = String(ex.name ?? "").trim() || (ex.id as string);
  const executorExchangeId = String((ex as { exchange_id?: string | null }).exchange_id ?? "").trim();

  const [{ data: rows, error: budgetsErr }, quoteAssetOptionsByExchange] = await Promise.all([
    supabase
      .schema("trading")
      .from("executor_quote_asset_budget")
      .select("id, quote_asset_id, max_notional_primary, created_at, updated_at")
      .eq("executor_id", id)
      .order("created_at", { ascending: true }),
    fetchQuoteAssetOptionsByExchange(supabase),
  ]);

  const list = (rows ?? []) as BudgetRow[];

  const assetIds = [...new Set(list.map((r) => r.quote_asset_id))].filter(Boolean);
  const codeById = new Map<string, string>();
  if (assetIds.length) {
    let assets: Awaited<ReturnType<typeof AssetsSelector.selectIdCodeByIds>> = [];
    try {
      assets = await AssetsSelector.selectIdCodeByIds(supabase, assetIds);
    } catch {
      /* preserve original soft-fail behavior — codeById stays empty */
    }
    for (const a of assets) {
      codeById.set(a.id, a.code);
    }
  }

  const existingIds = new Set(list.map((r) => r.quote_asset_id));
  const quoteOptsForThisExchange = quoteAssetOptionsByExchange[executorExchangeId] ?? [];
  const availableQuoteOptionsForNew = quoteOptsForThisExchange.filter(
    (o) => !existingIds.has(o.id),
  );

  return (
    <ListViewLayout className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("executor_quote_asset_budgets")!}
        title="Quote-asset budgets"
        rowCount={list.length}
        sortLine="Created (oldest first) · per-quote notional caps in your primary fiat"
        uncapped
        subtitle={
          <>
            One row per quote asset on executor <strong>{executorName}</strong>. Notional is stored in
            your primary fiat (<code className="bk-code">{primaryCode}</code>) and converted to the
            market quote at decision time.
          </>
        }
        actions={
          <>
            <ExecutorQuoteBudgetCreateDialog
              executorId={id}
              availableOptions={availableQuoteOptionsForNew}
              primaryCode={primaryCode}
            />
            <Link href={`/executors/${id}`} className="bk-link text-sm">
              ← {executorName}
            </Link>
          </>
        }
      />

      {budgetsErr ? <Alert tone="error">{budgetsErr.message}</Alert> : null}

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-sm">
              <thead>
                <tr>
                  <Th>Quote asset</Th>
                  <Th className="text-right">Max notional ({primaryCode})</Th>
                  <Th>Created</Th>
                  <Th>Updated</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <Td colSpan={5} className="bk-text-muted text-center">
                      No quote-asset budgets configured. Use <em>New</em> above to add one.
                    </Td>
                  </tr>
                ) : (
                  list.map((row) => {
                    const code =
                      codeById.get(row.quote_asset_id) ?? `${row.quote_asset_id.slice(0, 8)}…`;
                    return (
                      <tr key={row.id}>
                        <Td>
                          <code className="bk-code">{code}</code>
                        </Td>
                        <Td className="text-right font-mono tabular-nums">
                          {fmtAmount(row.max_notional_primary)}
                        </Td>
                        <Td className="whitespace-nowrap text-xs">{fmtDt(row.created_at)}</Td>
                        <Td className="whitespace-nowrap text-xs">{fmtDt(row.updated_at)}</Td>
                        <Td>
                          <div className="flex items-center justify-end gap-1">
                            <ExecutorQuoteBudgetEditDialog
                              executorId={id}
                              budgetId={row.id}
                              currentQuoteAssetId={row.quote_asset_id}
                              currentQuoteAssetCode={code}
                              currentMaxNotionalPrimary={String(row.max_notional_primary ?? "")}
                              availableOptions={availableQuoteOptionsForNew}
                              primaryCode={primaryCode}
                            />
                            <ExecutorQuoteBudgetDeleteDialog
                              executorId={id}
                              budgetId={row.id}
                              quoteAssetCode={code}
                            />
                          </div>
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>
    </ListViewLayout>
  );
}
