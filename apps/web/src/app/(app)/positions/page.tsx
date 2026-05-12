import { PositionsListView } from "./positions-list-view";
import { parseListPage, pickSearchParamString } from "@/lib/dashboard/list-pagination";

type PositionsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PositionsPage({ searchParams }: PositionsPageProps) {
  const sp = (await searchParams) ?? {};
  const executorIdFilter = pickSearchParamString(sp, "executorId") ?? null;
  const page = parseListPage(sp);
  return (
    <PositionsListView
      executorIdFilter={executorIdFilter}
      paginationPathname="/positions"
      page={page}
    />
  );
}
