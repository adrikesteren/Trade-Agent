import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Alert, Card, CardBody } from "@repo/blocks";

const CHUNK = 120;

async function fetchExecutorNamesById(
  supabase: SupabaseClient,
  executorIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!executorIds.length) return map;
  const unique = [...new Set(executorIds)];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase.schema("trading").from("executors").select("id, name").in("id", chunk);
    if (error) {
      console.error("positions page: executors batch:", error.message);
      continue;
    }
    for (const e of data ?? []) {
      map.set(e.id as string, String(e.name ?? "").trim() || (e.id as string));
    }
  }
  return map;
}

type PositionsPageProps = {
  searchParams?: Promise<{ executorId?: string | string[] }>;
};

export default async function PositionsPage({ searchParams }: PositionsPageProps) {
  const sp = (await searchParams) ?? {};
  const executorIdFilter = typeof sp.executorId === "string" && sp.executorId.trim() ? sp.executorId.trim() : null;

  const supabase = await createClient();
  let q = supabase
    .schema("trading")
    .from("positions")
    .select("id, user_id, executor_id, market_id, quantity, avg_price, paper, updated_at")
    .order("updated_at", { ascending: false })
    .limit(DASHBOARD_LIST_VIEW_LIMIT);
  if (executorIdFilter) {
    q = q.eq("executor_id", executorIdFilter);
  }
  const { data: rows, error } = await q;

  const list = rows ?? [];
  const executorIds = [...new Set((list as { executor_id?: string }[]).map((r) => r.executor_id).filter(Boolean))] as string[];
  const executorNameById = await fetchExecutorNamesById(supabase, executorIds);

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Trading"
        title="Positions"
        iconLetter="P"
        rowCount={list.length}
        sortLine={
          executorIdFilter
            ? "Filtered by executor · sorted by updated date (newest first)"
            : "Sorted by updated date (newest first)"
        }
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      <Card>
        <CardBody>
          <pre className="bk-pre">
            {JSON.stringify(
              list.map((r) => {
                const row = r as Record<string, unknown>;
                const eid = String(row.executor_id ?? "");
                return { ...row, executor_name: eid ? executorNameById.get(eid) ?? eid : null };
              }),
              null,
              2,
            )}
          </pre>
        </CardBody>
      </Card>
    </div>
  );
}
