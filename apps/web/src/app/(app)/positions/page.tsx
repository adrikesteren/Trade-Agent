import { PositionsListView } from "./positions-list-view";

type PositionsPageProps = {
  searchParams?: Promise<{ executorId?: string | string[] }>;
};

export default async function PositionsPage({ searchParams }: PositionsPageProps) {
  const sp = (await searchParams) ?? {};
  const executorIdFilter = typeof sp.executorId === "string" && sp.executorId.trim() ? sp.executorId.trim() : null;
  return <PositionsListView executorIdFilter={executorIdFilter} />;
}
