import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";
import * as WalletsSelector from "@/lib/selectors/wallets-selector";
import { createClient } from "@/lib/supabase/server";
import {
  DetailPageLayout,
  Output,
  RecordPageCard,
  RecordPageGrid,
  RecordPageSection,
} from "@adrikesteren/adricore/blocks";
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

  let row: WalletsSelector.WalletDetailRow | null = null;
  try {
    row = await WalletsSelector.selectDetailById(supabase, walletId);
  } catch {
    notFound();
  }
  if (!row) notFound();

  const executorId = String(row.executor_id ?? "").trim();
  let exName: string | null = null;
  if (executorId) {
    try {
      exName = await ExecutorsSelector.selectNameById(supabase, executorId);
    } catch {
      /* preserve original soft-fail behavior — executorName falls back to "—" */
    }
  }
  const executorName = String(exName ?? "").trim() || "—";

  return (
    <DetailPageLayout
      className="bk-container bk-container_lg"
      header={
        objectRegistry.registrations.get("wallets")!.CreateDetailPageHeader({
          record: row as Record<string, unknown>,
          title: shortId(walletId),
          titleClassName: "font-mono",
          subtitle: executorId ? `Executor: ${executorName}` : "Portfolio wallet",
        })
      }
      content={
        <RecordPageCard>
          <RecordPageSection title="Details">
            <RecordPageGrid>
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
            </RecordPageGrid>
          </RecordPageSection>
        </RecordPageCard>
      }
    />
  );
}
