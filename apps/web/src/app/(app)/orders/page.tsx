import { OrdersListView } from "./orders-list-view";
import { parseListPage } from "@/lib/dashboard/list-pagination";

type OrdersPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const sp = (await searchParams) ?? {};
  const executorIdFilter = typeof sp.executorId === "string" && sp.executorId.trim() ? sp.executorId.trim() : null;
  const page = parseListPage(sp);
  return (
    <OrdersListView
      executorIdFilter={executorIdFilter}
      paginationPathname="/orders"
      page={page}
    />
  );
}
