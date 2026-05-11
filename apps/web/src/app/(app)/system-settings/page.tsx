import Link from "next/link";

import { isDashboardAdministrator } from "@/lib/auth/is-dashboard-administrator";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { getNumericSystemSetting } from "@/lib/system-settings/read-settings";
import { listNumericSystemSettingDefs } from "@/lib/system-settings/registry";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  Alert,
  Card,
  CardBody,
  ListViewObjectIcon,
  ListViewPlaceholderToolbar,
  ListViewTitlePickerPlaceholder,
  PageHeader,
  Table,
  TableWrap,
  Td,
  Th,
  listViewOutlineActionClass,
} from "@repo/blocks";

export default async function SystemSettingsListPage() {
  const isAdmin = await isDashboardAdministrator();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date | null) =>
    v == null || v === "" ? "—" : formatDatetime(v, prefs);

  if (!isAdmin) {
    return (
      <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
        <PageHeader
          variant="list"
          icon={<ListViewObjectIcon letter="S" />}
          eyebrow="System"
          title="System settings"
          titleAddon={<ListViewTitlePickerPlaceholder />}
          subtitle="Administrator role is required to view rows in public.system_settings."
          summary="Promote your user in SQL (see docs/ops-developer.md) or ask an administrator."
          toolbar={<ListViewPlaceholderToolbar />}
          actions={
            <Link href="/overview" className={listViewOutlineActionClass}>
              Overview
            </Link>
          }
        />
      </div>
    );
  }

  const admin = createServiceRoleClient();
  const defs = listNumericSystemSettingDefs();
  const keys = defs.map((d) => d.key);

  const { data: dbRows, error: dbErr } =
    keys.length === 0
      ? { data: [] as { key: string; value: unknown; updated_at: string | null }[], error: null }
      : await admin.from("system_settings").select("key, value, updated_at").in("key", keys);

  const byKey = new Map(
    (dbRows ?? []).map((r) => {
      const row = r as { key: string; value: unknown; updated_at: string | null };
      return [row.key, row] as const;
    }),
  );

  const rows = await Promise.all(
    defs.map(async (def) => {
      const db = byKey.get(def.key);
      const effective = await getNumericSystemSetting(admin, def.key);
      return {
        def,
        effective,
        updatedAt: db?.updated_at ?? null,
      };
    }),
  );

  const n = rows.length;
  const summaryBits = [
    `${n} setting${n === 1 ? "" : "s"}`,
    "public.system_settings",
    "Open a row for Edit (dialog) or Delete (confirm)",
  ];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <PageHeader
        variant="list"
        icon={<ListViewObjectIcon letter="S" />}
        eyebrow="System"
        title="System settings"
        titleAddon={<ListViewTitlePickerPlaceholder />}
        subtitle={
          <>
            Key/value rows in <code className="bk-code">public.system_settings</code> override matching{" "}
            <code className="bk-code">process.env</code> at read time. Missing rows use env, then built-in defaults.
          </>
        }
        summary={summaryBits.join(" · ")}
        toolbar={<ListViewPlaceholderToolbar />}
        actions={
          <>
            <Link href="/sync-runs" className={listViewOutlineActionClass}>
              Sync runs
            </Link>
            <Link href="/overview" className={listViewOutlineActionClass}>
              Overview
            </Link>
          </>
        }
      />

      {dbErr ? <Alert tone="error">{dbErr.message}</Alert> : null}

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Setting</Th>
                  <Th>Key</Th>
                  <Th className="text-right">Effective value</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ def, effective, updatedAt }) => (
                  <tr key={def.key}>
                    <Td>
                      <Link href={`/system-settings/${encodeURIComponent(def.key)}`} className="bk-link">
                        {def.label}
                      </Link>
                    </Td>
                    <Td>
                      <code className="bk-code">{def.key}</code>
                    </Td>
                    <Td className="text-right font-mono">{effective}</Td>
                    <Td className="text-neutral-600 dark:text-neutral-400">{formatDt(updatedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>
    </div>
  );
}
