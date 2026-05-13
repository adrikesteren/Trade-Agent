import { SystemSettingDetailActions } from "@/app/(app)/system-settings/[key]/system-setting-detail-actions";
import { isDashboardAdministrator } from "@/lib/auth/is-dashboard-administrator";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { getNumericSystemSetting } from "@/lib/system-settings/read-settings";
import {
  getNumericSystemSettingDef,
  type SystemSettingNumericKey,
} from "@/lib/system-settings/registry";
import { createServiceRoleClient } from "@/lib/supabase/admin";
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

type PageProps = { params: Promise<{ key: string }> };

function parseStoredNumeric(raw: unknown): string {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (raw && typeof raw === "object" && "n" in raw) {
    const n = Number((raw as { n: unknown }).n);
    if (Number.isFinite(n)) return String(n);
  }
  return "—";
}

export default async function SystemSettingDetailPage({ params }: PageProps) {
  const { key: rawKey } = await params;
  const settingKey = decodeURIComponent(rawKey).trim();
  const def = getNumericSystemSettingDef(settingKey);
  if (!def) {
    notFound();
  }

  const isAdmin = await isDashboardAdministrator();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date | null) =>
    v == null || v === "" ? "—" : formatDatetime(v, prefs);

  if (!isAdmin) {
    return (
      <DetailPageLayout
        className="bk-container px-1"
        header={
          <PageHeader
            variant="detail"
            icon={<ListViewObjectIcon letter="S" />}
            eyebrow="System setting"
            title={def.label}
            back={{ href: "/system-settings", label: "Back to system settings" }}
            subtitle="Administrator role is required to view or edit this row."
            meta={settingKey}
          />
        }
        content={
          <RecordDetailCard>
            <RecordDetailSection title="Access">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Promote your user in SQL (see docs/ops-developer.md) or ask an administrator.
              </p>
            </RecordDetailSection>
          </RecordDetailCard>
        }
      />
    );
  }

  const admin = createServiceRoleClient();
  const { data: row } = await admin
    .from("system_settings")
    .select("key, value, updated_at")
    .eq("key", settingKey)
    .maybeSingle();

  const effective = await getNumericSystemSetting(admin, settingKey as SystemSettingNumericKey);
  const db = row as { key: string; value: unknown; updated_at: string | null } | null;

  return (
    <DetailPageLayout
      className="bk-container px-1"
      header={
        <PageHeader
          variant="detail"
          icon={<ListViewObjectIcon letter="S" />}
          eyebrow="System setting"
          title={def.label}
          back={{ href: "/system-settings", label: "Back to system settings" }}
          highlights={
            <>
              <Output label="Effective value" type="number" value={effective} />
              <Output label="Env fallback" type="text" value={def.envFallbackVar} />
            </>
          }
          subtitle={def.description}
          meta={settingKey}
          actions={
            <SystemSettingDetailActions
              settingKey={settingKey}
              label={def.label}
              def={{ min: def.min, max: def.max, integer: def.integer, envFallbackVar: def.envFallbackVar }}
              currentNumeric={effective}
            />
          }
        />
      }
      content={
        <RecordDetailCard>
          <RecordDetailSection title="Details">
            <RecordDetailGrid>
              <Output label="Key" type="text" value={settingKey} span="full" />
              <Output label="Label" type="text" value={def.label} span="full" />
              <Output label="Stored value (DB)" type="text" value={db ? parseStoredNumeric(db.value) : "— (no row)"} />
              <Output label="Effective value" type="number" value={effective} />
              <Output label="Required" type="text" value={def.required ? "Yes" : "No"} />
              <Output label="Optional" type="text" value={def.optional ? "Yes" : "No"} />
              <Output label="Min / max" type="text" value={`${def.min} / ${def.max}`} />
              <Output
                label="Updated"
                type="datetime"
                value={db?.updated_at ?? null}
                formatDatetime={formatDt}
              />
            </RecordDetailGrid>
          </RecordDetailSection>
        </RecordDetailCard>
      }
    />
  );
}
