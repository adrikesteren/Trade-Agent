import { OrdersListView } from "./orders-list-view";

type OrdersPageProps = {
  searchParams?: Promise<{ executorId?: string | string[] }>;
};

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const sp = (await searchParams) ?? {};
  const executorIdFilter = typeof sp.executorId === "string" && sp.executorId.trim() ? sp.executorId.trim() : null;
  return <OrdersListView executorIdFilter={executorIdFilter} />;
}
