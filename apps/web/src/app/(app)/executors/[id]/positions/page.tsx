import { PositionsListView } from "@/app/(app)/positions/positions-list-view";
import { parseListPage } from "@/lib/dashboard/list-pagination";
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";
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
  let ex: ExecutorsSelector.ExecutorIdNameRow | null = null;
  try {
    ex = await ExecutorsSelector.selectIdAndNameById(supabase, id);
  } catch {
    notFound();
  }
  if (!ex) notFound();
  const name = String(ex.name ?? "").trim() || ex.id;
  return (
    <PositionsListView
      executorIdFilter={id}
      parentExecutor={{ id: ex.id, name }}
      paginationPathname={`/executors/${id}/positions`}
      page={page}
    />
  );
}
