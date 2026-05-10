"use client";

import type { UpstashScheduleListRow } from "@/lib/dashboard/upstash-schedule-list-row";
import {
  Alert,
  Button,
  Card,
  CardBody,
  Switch,
  Table,
  TableWrap,
  Td,
  Th,
} from "@repo/blocks";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type ListJson =
  | { ok: true; tokenConfigured: boolean; schedules: UpstashScheduleListRow[] }
  | { ok: false; error?: string };

export function UpstashSchedulesListClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [rows, setRows] = useState<UpstashScheduleListRow[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchErr(null);
    try {
      const res = await fetch("/api/dashboard/upstash/schedules", { credentials: "include" });
      const raw = await res.text();
      let data: ListJson = { ok: false };
      if (raw) {
        try {
          data = JSON.parse(raw) as ListJson;
        } catch {
          setFetchErr("Invalid JSON from server");
          return;
        }
      }
      if (!res.ok) {
        setFetchErr("error" in data && typeof data.error === "string" ? data.error : res.statusText);
        return;
      }
      if (!data.ok) {
        setFetchErr(typeof data.error === "string" ? data.error : "List failed");
        return;
      }
      setTokenConfigured(data.tokenConfigured);
      setRows(data.schedules ?? []);
    } catch {
      setFetchErr("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(id);
  }, [load]);

  const onToggle = useCallback(
    (row: UpstashScheduleListRow, nextActive: boolean) => {
      const action = nextActive ? "resume" : "pause";
      setActionErr(null);
      setActingId(row.scheduleId);
      void (async () => {
        try {
          const res = await fetch("/api/dashboard/upstash/schedules", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scheduleId: row.scheduleId, action }),
          });
          const raw = await res.text();
          let body: { error?: string } = {};
          if (raw) {
            try {
              body = JSON.parse(raw) as { error?: string };
            } catch {
              setActionErr("Invalid JSON");
              return;
            }
          }
          if (!res.ok) {
            setActionErr(body.error ?? res.statusText);
            return;
          }
          await load();
          router.refresh();
        } catch {
          setActionErr("Network error");
        } finally {
          setActingId(null);
        }
      })();
    },
    [load, router],
  );

  if (loading) {
    return (
      <Card>
        <CardBody>
          <p className="bk-text-muted text-sm">Loading QStash schedules…</p>
        </CardBody>
      </Card>
    );
  }

  if (fetchErr) {
    return (
      <Card>
        <CardBody>
          <Alert tone="error">{fetchErr}</Alert>
          <Button type="button" className="mt-3" variant="neutral" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </CardBody>
      </Card>
    );
  }

  if (!tokenConfigured) {
    return (
      <Card>
        <CardBody>
          <Alert tone="warning">
            <code className="bk-code">QSTASH_TOKEN</code> is not set in the server environment. Configure it to list and
            control schedules.
          </Alert>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="bk-stack bk-stack_gap-md">
      {actionErr ? <Alert tone="error">{actionErr}</Alert> : null}

      <Card>
        <CardBody className="!pt-0">
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="neutral" size="sm" onClick={() => void load()} disabled={actingId != null}>
              Refresh
            </Button>
          </div>
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Active</Th>
                  <Th>Name</Th>
                  <Th>Path</Th>
                  <Th>Schedule id</Th>
                  <Th>Cron (UTC)</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <Td colSpan={5}>
                      <span className="bk-text-muted">No schedules in this QStash project.</span>
                    </Td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const busy = actingId === r.scheduleId;
                    const active = !r.isPaused;
                    return (
                      <tr key={r.scheduleId}>
                        <Td>
                          <Switch
                            checked={active}
                            disabled={busy}
                            onCheckedChange={(checked) => {
                              if (busy) return;
                              if (checked === active) return;
                              onToggle(r, checked);
                            }}
                            aria-label={active ? `Pause ${r.displayName}` : `Resume ${r.displayName}`}
                          />
                        </Td>
                        <Td>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium">{r.displayName}</span>
                            {r.managed ? (
                              <span className="bk-text-muted text-[10px]">Trade Agent managed</span>
                            ) : null}
                          </div>
                        </Td>
                        <Td>
                          <code className="bk-code max-w-[min(28rem,55vw)] truncate text-[10px]" title={r.path}>
                            {r.path}
                          </code>
                        </Td>
                        <Td>
                          <code className="bk-code text-[10px]">{r.scheduleId}</code>
                        </Td>
                        <Td>
                          <span className="bk-text-muted font-mono text-[10px]">{r.cron ?? "—"}</span>
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>
    </div>
  );
}
