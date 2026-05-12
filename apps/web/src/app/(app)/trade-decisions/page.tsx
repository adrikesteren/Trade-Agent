import { TradeDecisionsListView } from "./trade-decisions-list-view";
import { parseListPage, pickSearchParamString } from "@/lib/dashboard/list-pagination";

type TradeDecisionsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TradeDecisionsPage({ searchParams }: TradeDecisionsPageProps) {
  const sp = (await searchParams) ?? {};
  const executorIdFilter = pickSearchParamString(sp, "executorId") ?? null;
  const page = parseListPage(sp);
  return (
    <TradeDecisionsListView
      executorIdFilter={executorIdFilter}
      showCronBanner
      paginationPathname="/trade-decisions"
      page={page}
    />
  );
}
