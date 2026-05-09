import { createClient } from "@/lib/supabase/server";
import {
  Breadcrumbs,
  ListViewObjectIcon,
  Output,
  PageHeader,
  RecordDetailCard,
  RecordDetailGrid,
  RecordDetailLayout,
  RecordDetailSection,
} from "@repo/blocks";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ exchangeId: string }> };

export default async function ExchangeDetailPage({ params }: PageProps) {
  const { exchangeId } = await params;
  const supabase = await createClient();

  const { data: ex, error } = await supabase
    .schema("catalog")
    .from("exchanges")
    .select("id, code, name, created_at")
    .eq("id", exchangeId)
    .maybeSingle();

  if (error || !ex) {
    notFound();
  }

  const { data: markets, count } = await supabase
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol, quote_code, status", { count: "exact" })
    .eq("exchange_id", exchangeId)
    .order("market_symbol", { ascending: true })
    .limit(150);

  const list = markets ?? [];
  const countLabel = typeof count === "number" ? `${list.length} of ${count}` : String(list.length);

  return (
    <RecordDetailLayout className="bk-container bk-stack bk-stack_gap-md px-1" style={{ maxWidth: "48rem" }}>
      <PageHeader
        variant="detail"
        icon={<ListViewObjectIcon letter="E" />}
        breadcrumb={
          <Breadcrumbs items={[{ label: "Exchanges", href: "/dashboard/exchanges" }, { label: "Detail" }]} />
        }
        back={{ href: "/dashboard/exchanges", label: "← All exchanges" }}
        eyebrow="Exchange"
        title={ex.name}
        highlights={
          <>
            <Output label="Code" type="text" value={ex.code} />
            <Output label="Markets" type="text" value={countLabel} />
          </>
        }
        meta={`id: ${ex.id}`}
      />

      <RecordDetailCard>
        <RecordDetailSection title="Details">
          <RecordDetailGrid>
            <Output label="Record ID" type="text" value={ex.id} span="full" />
            <Output label="Code" type="text" value={ex.code} />
            <Output label="Name" type="text" value={ex.name?.trim() ? ex.name : "—"} />
            <Output label="Created" type="datetime" value={ex.created_at} />
          </RecordDetailGrid>
        </RecordDetailSection>

        <RecordDetailSection
          title="Markets"
          description={typeof count === "number" ? `Showing ${list.length} of ${count} listings.` : undefined}
        >
          <ul className="bk-list-divided">
            {list.map((m) => (
              <li key={m.id} className="py-2">
                <Link href={`/dashboard/markets/${m.id}`} className="bk-link font-mono" style={{ fontWeight: 600 }}>
                  {m.market_symbol}
                </Link>
                <span className="bk-text-muted ml-2" style={{ fontSize: "0.75rem" }}>
                  {m.quote_code} · {m.status}
                </span>
              </li>
            ))}
            {!list.length ? (
              <li className="bk-text-muted py-4" style={{ fontSize: "0.8125rem" }}>
                No markets synced for this exchange yet.
              </li>
            ) : null}
          </ul>
        </RecordDetailSection>
      </RecordDetailCard>
    </RecordDetailLayout>
  );
}
