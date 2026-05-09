import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
import { ensureUserExecutorExists } from "@/lib/trading/executors";
import { createClient } from "@/lib/supabase/server";
import {
  Alert,
  Card,
  CardBody,
  Table,
  TableWrap,
  Td,
  Th,
  listViewOutlineActionClass,
} from "@repo/blocks";
import Link from "next/link";
import { redirect } from "next/navigation";

type ExecutorListRow = {
  id: string;
  name: string;
  enabled: boolean;
  execution_mode: string;
  budget_eur: string | number | null;
  asset_filter_mode: string;
};

export default async function ExecutorsListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await ensureUserExecutorExists(supabase, user.id);

  const { data: rows, error } = await supabase
    .schema("trading")
    .from("executors")
    .select("id, name, enabled, execution_mode, budget_eur, asset_filter_mode, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const list = (rows ?? []) as ExecutorListRow[];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Trading"
        title="Executors"
        iconLetter="E"
        rowCount={list.length}
        sortLine="Portfolios: paper/live, budget, and asset filters"
        actions={
          <Link href="/dashboard/executors/new" className={listViewOutlineActionClass}>
            New executor
          </Link>
        }
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Mode</Th>
                  <Th>Budget (EUR)</Th>
                  <Th>Filter</Th>
                  <Th>Enabled</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.id}>
                    <Td className="font-medium">{row.name}</Td>
                    <Td className="font-mono">{row.execution_mode}</Td>
                    <Td className="font-mono">
                      {row.budget_eur === null || row.budget_eur === undefined || String(row.budget_eur).trim() === ""
                        ? "—"
                        : String(row.budget_eur)}
                    </Td>
                    <Td className="font-mono">{row.asset_filter_mode}</Td>
                    <Td>{row.enabled ? "yes" : "no"}</Td>
                    <Td>
                      <Link href={`/dashboard/executors/${row.id}`} className="bk-link">
                        Open
                      </Link>
                    </Td>
                  </tr>
                ))}
                {!list.length ? (
                  <tr>
                    <Td colSpan={6} muted className="py-8 text-center">
                      No executors yet.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>
    </div>
  );
}
