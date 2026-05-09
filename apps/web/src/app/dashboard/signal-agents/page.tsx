import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
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

export default async function SignalAgentsPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .schema("trading")
    .from("signal_agents")
    .select("id, agent_id, enabled, version, description, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const list = rows ?? [];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Automation"
        title="Signal Agents"
        iconLetter="A"
        rowCount={list.length}
        sortLine="Sorted by Created date"
        actions={
          <>
            <Link href="/dashboard/signals" className={listViewOutlineActionClass}>
              Signals
            </Link>
            <Link href="/dashboard" className={listViewOutlineActionClass}>
              Dashboard
            </Link>
          </>
        }
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Agent key</Th>
                  <Th>Enabled</Th>
                  <Th>Version</Th>
                  <Th>Description</Th>
                  <Th>Updated (UTC)</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.id as string}>
                    <Td>
                      <Link href={`/dashboard/signal-agents/${row.id}`} className="bk-link font-mono">
                        {row.agent_id as string}
                      </Link>
                    </Td>
                    <Td>{row.enabled ? "Yes" : "No"}</Td>
                    <Td>{(row.version as string | null)?.trim() || "—"}</Td>
                    <Td className="max-w-md truncate" title={(row.description as string | null) ?? undefined}>
                      {(row.description as string | null)?.trim() || "—"}
                    </Td>
                    <Td className="whitespace-nowrap font-mono">
                      {row.updated_at
                        ? String(row.updated_at).slice(0, 19).replace("T", " ")
                        : "—"}
                    </Td>
                  </tr>
                ))}
                {!list.length ? (
                  <tr>
                    <Td colSpan={5} muted className="py-8 text-center">
                      No signal agents. Run migrations — the seed inserts <code className="bk-code">ma-cross-5m-v1</code>.
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
