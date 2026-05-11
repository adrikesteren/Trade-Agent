import { OrdersListView } from "@/app/(app)/orders/orders-list-view";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

export default async function ExecutorOrdersRelatedPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: ex, error } = await supabase.schema("trading").from("executors").select("id, name").eq("id", id).maybeSingle();
  if (error || !ex) notFound();
  const name = String(ex.name ?? "").trim() || (ex.id as string);
  return <OrdersListView executorIdFilter={id} parentExecutor={{ id: ex.id as string, name }} />;
}
