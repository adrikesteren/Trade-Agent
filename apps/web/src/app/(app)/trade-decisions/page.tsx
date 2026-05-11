import { TradeDecisionsListView } from "./trade-decisions-list-view";

type TradeDecisionsPageProps = {
  searchParams?: Promise<{ executorId?: string | string[] }>;
};

export default async function TradeDecisionsPage({ searchParams }: TradeDecisionsPageProps) {
  const sp = (await searchParams) ?? {};
  const executorIdFilter = typeof sp.executorId === "string" && sp.executorId.trim() ? sp.executorId.trim() : null;
  return <TradeDecisionsListView executorIdFilter={executorIdFilter} showCronBanner />;
}
