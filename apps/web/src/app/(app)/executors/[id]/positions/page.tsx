import { PositionsListView } from "@/app/(app)/positions/positions-list-view";
import { parseListPage } from "@/lib/dashboard/list-pagination";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ExecutorPositionsRelatedPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const page = parseListPage(sp);
  const supabase = await createClient();
  const { data: ex, error } = await supabase.schema("trading").from("executors").select("id, name").eq("id", id).maybeSingle();
  if (error || !ex) notFound();
  const name = String(ex.name ?? "").trim() || (ex.id as string);
  return (
    <PositionsListView
      executorIdFilter={id}
      parentExecutor={{ id: ex.id as string, name }}
      paginationPathname={`/executors/${id}/positions`}
      page={page}
    />
  );
}
