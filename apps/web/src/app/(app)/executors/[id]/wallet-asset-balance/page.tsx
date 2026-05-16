import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { formatDatetime, formatDecimal } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
import * as AssetsSelector from "@/lib/selectors/assets-selector";
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";
import * as WalletAssetBalanceSelector from "@/lib/selectors/wallet-asset-balance-selector";
import * as WalletsSelector from "@/lib/selectors/wallets-selector";
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

type BalanceRow = WalletAssetBalanceSelector.WalletAssetBalanceListRow;

/**
 * Read-only view-all of all `trading.wallet_asset_balance` rows for the executor's wallet.
 *
 * The table is maintained by the `trg_wallet_transactions_touch_wallet_asset_balance`
 * trigger on each `wallet_transactions` insert — there is no CRUD UI here.
 */
export default async function ExecutorWalletAssetBalanceRelatedPage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const prefs = await getUserLocalePreferences();
  const fmtQty = (v: string | number | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 0, maximumFractionDigits: 8 });
  const fmtDt = (v: string | number | Date | null) =>
    v == null || v === "" ? "—" : formatDatetime(v, prefs);

  let ex: ExecutorsSelector.ExecutorIdWalletNameRow | null = null;
  try {
    ex = await ExecutorsSelector.selectIdWalletNameByIdAndUser(supabase, { id, userId: user.id });
  } catch {
    notFound();
  }
  if (!ex) notFound();

  const walletIdFromExecutor = String(ex.wallet_id ?? "").trim();
  let walletId = walletIdFromExecutor;
  if (!walletId) {
    try {
      walletId = String((await WalletsSelector.selectIdByExecutorId(supabase, id)) ?? "").trim();
    } catch {
      walletId = "";
    }
  }

  let rows: BalanceRow[] = [];
  let error: { message: string } | null = null;
  if (walletId) {
    try {
      rows = await WalletAssetBalanceSelector.selectListByWallet(supabase, walletId);
    } catch (e) {
      error = { message: e instanceof Error ? e.message : String(e) };
    }
  }

  const list = rows;

  const assetIds = [...new Set(list.map((r) => r.asset_id))].filter(Boolean);
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

  const executorName = String(ex.name ?? "").trim() || ex.id;

  return (
    <ListViewLayout className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("wallet_asset_balance")!}
        title="Wallet asset balances"
        rowCount={list.length}
        sortLine="Updated (newest first) · system-maintained by wallet_transactions trigger"
        uncapped
        subtitle={
          <>
            Per-asset balance for the wallet of executor <strong>{executorName}</strong>. Read-only;
            credit assets via <em>Add balance</em> on the executor detail page.
          </>
        }
        actions={
          <Link href={`/executors/${id}`} className="bk-link text-sm">
            ← {executorName}
          </Link>
        }
      />

      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-sm">
              <thead>
                <tr>
                  <Th>Asset</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <Td colSpan={3} className="bk-text-muted text-center">
                      No wallet asset balances yet.
                    </Td>
                  </tr>
                ) : (
                  list.map((row) => {
                    const code = codeById.get(row.asset_id) ?? `${row.asset_id.slice(0, 8)}…`;
                    return (
                      <tr key={row.id}>
                        <Td>
                          <code className="bk-code">{code}</code>
                        </Td>
                        <Td className="text-right font-mono tabular-nums">{fmtQty(row.amount)}</Td>
                        <Td className="whitespace-nowrap text-xs">{fmtDt(row.updated_at)}</Td>
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
