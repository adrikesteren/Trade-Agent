import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody } from "@repo/blocks";

export default async function OrdersPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .schema("trading")
    .from("orders")
    .select("id, user_id, decision_id, market_id, side, quantity, status, paper, external_id, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const list = rows ?? [];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Trading"
        title="Orders"
        iconLetter="O"
        rowCount={list.length}
        sortLine="Sorted by Created date"
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
