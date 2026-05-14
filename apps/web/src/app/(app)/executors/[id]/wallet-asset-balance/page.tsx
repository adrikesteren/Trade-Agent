import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { formatDatetime, formatDecimal } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
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
} from "@repo/adricore/blocks";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

type BalanceRow = {
  id: string;
  asset_id: string;
  amount: string | number | null;
  updated_at: string;
};

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

  const { data: ex, error: exErr } = await supabase
    .schema("trading")
    .from("executors")
    .select("id, wallet_id, name")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (exErr || !ex) notFound();

  const walletIdFromExecutor = String((ex as { wallet_id?: string | null }).wallet_id ?? "").trim();
  let walletId = walletIdFromExecutor;
  if (!walletId) {
    const { data: walletRow } = await supabase
      .schema("trading")
      .from("wallets")
      .select("id")
      .eq("executor_id", id)
      .maybeSingle();
    walletId = String((walletRow as { id?: string } | null)?.id ?? "").trim();
  }

  const { data: rows, error } = walletId
    ? await supabase
        .schema("trading")
        .from("wallet_asset_balance")
        .select("id, asset_id, amount, updated_at")
        .eq("wallet_id", walletId)
        .order("updated_at", { ascending: false })
    : { data: [] as BalanceRow[], error: null };

  const list = (rows ?? []) as BalanceRow[];

  const assetIds = [...new Set(list.map((r) => r.asset_id))].filter(Boolean);
  const codeById = new Map<string, string>();
  if (assetIds.length) {
    const { data: assets } = await supabase
      .schema("catalog")
      .from("assets")
      .select("id, code")
      .in("id", assetIds);
    for (const a of (assets ?? []) as { id: string; code: string }[]) {
      codeById.set(a.id, a.code);
    }
  }

  const executorName = String(ex.name ?? "").trim() || (ex.id as string);

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
