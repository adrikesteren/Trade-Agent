import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody } from "@repo/blocks";

type FillsPageProps = {
  searchParams?: Promise<{ orderId?: string | string[] }>;
};

export default async function FillsPage({ searchParams }: FillsPageProps) {
  const sp = (await searchParams) ?? {};
  const orderIdFilter = typeof sp.orderId === "string" && sp.orderId.trim() ? sp.orderId.trim() : null;

  const supabase = await createClient();
  let q = supabase
    .schema("trading")
    .from("fills")
    .select("id, user_id, order_id, price, quantity, fee, created_at")
    .order("created_at", { ascending: false })
    .limit(DASHBOARD_LIST_VIEW_LIMIT);
  if (orderIdFilter) {
    q = q.eq("order_id", orderIdFilter);
  }
  const { data: rows, error } = await q;

  const list = rows ?? [];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Trading"
        title="Fills"
        iconLetter="F"
        rowCount={list.length}
        sortLine={
          orderIdFilter
            ? "Filtered by order · sorted by created date (newest first)"
            : "Sorted by created date (newest first)"
        }
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      <Card>
        <CardBody>
          <pre className="bk-pre">{JSON.stringify(list, null, 2)}</pre>
        </CardBody>
      </Card>
    </div>
  );
}
