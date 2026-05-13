import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { createClient } from "@/lib/supabase/server";
import {
  DetailPageLayout,
  ListViewObjectIcon,
  Output,
  PageHeader,
  RecordDetailCard,
  RecordDetailGrid,
  RecordDetailSection,
} from "@repo/adricore/blocks";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function shortId(uuid: string): string {
  const t = uuid.trim();
  return t.length >= 8 ? `${t.slice(0, 8)}…` : t;
}

export default async function WalletDetailPage({ params }: PageProps) {
  const { id: walletId } = await params;
  if (!isUuidLike(walletId)) notFound();

  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date | null | undefined) =>
    v == null ? "—" : formatDatetime(v, prefs);

  const { data: row, error } = await supabase
    .schema("trading")
    .from("wallets")
    .select("id, executor_id, created_at")
    .eq("id", walletId)
    .maybeSingle();

  if (error || !row) notFound();

  const executorId = String((row as { executor_id?: string }).executor_id ?? "").trim();
  const { data: exRow } = executorId
    ? await supabase.schema("trading").from("executors").select("name").eq("id", executorId).maybeSingle()
    : { data: null };
  const executorName = String((exRow as { name?: string } | null)?.name ?? "").trim() || "—";

  return (
    <DetailPageLayout
      className="bk-container bk-container_lg"
      header={
        <PageHeader
          variant="detail"
          icon={<ListViewObjectIcon letter="W" />}
          eyebrow="Wallet"
          title={shortId(walletId)}
          subtitle={executorId ? `Executor: ${executorName}` : "Portfolio wallet"}
        />
      }
      content={
        <RecordDetailCard>
          <RecordDetailSection title="Details">
            <RecordDetailGrid>
              <Output label="Wallet id" type="text" value={walletId} span="full" />
              {executorId ? (
                <Output
                  label="Executor"
                  record={{
                    pathPrefix: "/executors",
                    id: executorId,
                    name: executorName,
                  }}
                  value={executorName}
                />
              ) : (
                <Output label="Executor" type="text" value="—" />
              )}
              <Output label="Created" type="datetime" value={(row as { created_at?: string }).created_at} formatDatetime={formatDt} />
            </RecordDetailGrid>
          </RecordDetailSection>
        </RecordDetailCard>
      }
    />
  );
}
