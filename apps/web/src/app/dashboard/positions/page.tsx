import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody } from "@repo/blocks";

export default async function PositionsPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .schema("trading")
    .from("positions")
    .select("id, user_id, market_id, quantity, avg_price, paper, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  const list = rows ?? [];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Trading"
        title="Positions"
        iconLetter="P"
        rowCount={list.length}
        sortLine="Sorted by Updated date"
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
