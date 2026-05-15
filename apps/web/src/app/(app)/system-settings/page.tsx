import Link from "next/link";

import { isDashboardAdministrator } from "@/lib/auth/is-dashboard-administrator";
import { ListViewPagination } from "@/components/list-view-pagination";
import { ObjectListViewHeader } from "@/components/object-list-view-header";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { getNumericSystemSetting } from "@/lib/system-settings/read-settings";
import { listNumericSystemSettingDefs } from "@/lib/system-settings/registry";
import { objectRegistry } from "@/lib/objects/registry";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  Alert,
  Card,
  CardBody,
  Table,
  TableWrap,
  Td,
  Th,
  listViewOutlineActionClass,
} from "@adrikesteren/adricore/blocks";

export default async function SystemSettingsListPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const isAdmin = await isDashboardAdministrator();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date | null) =>
    v == null || v === "" ? "â€”" : formatDatetime(v, prefs);

  if (!isAdmin) {
    return (
      <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
        <ObjectListViewHeader
          model={objectRegistry.registrations.get("system_settings")!}
          rowCount={0}
          sortLine="Promote your user in SQL (see docs/ops-developer.md) or ask an administrator."
          subtitle="Administrator role is required to view rows in public.system_settings."
          uncapped
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
  const pages = totalPages(n, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);
  const pagedRows = rows.slice(from, to + 1);

  const sortLine = [
    `${n} setting${n === 1 ? "" : "s"}`,
    `Page ${page} of ${pages}`,
    "public.system_settings",
    "Open a row for Edit (dialog) or Delete (confirm)",
  ].join(" Â· ");

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("system_settings")!}
        rowCount={pagedRows.length}
        sortLine={sortLine}
        subtitle={
          <>
            Key/value rows in <code className="bk-code">public.system_settings</code> override matching{" "}
            <code className="bk-code">process.env</code> at read time. Missing rows use env, then built-in defaults.
          </>
        }
        actions={
          <Link href="/sync-runs" className={listViewOutlineActionClass}>
            Sync runs
          </Link>
        }
      />

      {dbErr ? <Alert tone="error">{dbErr.message}</Alert> : null}

      <ListViewPagination pathname="/system-settings" page={page} pageSize={pageSize} totalCount={n} />

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
                {pagedRows.map(({ def, effective, updatedAt }) => (
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

      <ListViewPagination pathname="/system-settings" page={page} pageSize={pageSize} totalCount={n} />
    </div>
  );
}
