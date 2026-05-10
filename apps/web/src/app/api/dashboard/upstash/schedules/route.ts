import { Client } from "@upstash/qstash";
import type { UpstashScheduleListRow } from "@/lib/dashboard/upstash-schedule-list-row";
import { createClient } from "@/lib/supabase/server";
import { isManagedQstashScheduleId } from "@/lib/workers/qstash-managed-schedules";
import { NextResponse } from "next/server";

async function requireSessionUser(): Promise<NextResponse | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

function pathFromDestination(destination: string): string {
  try {
    const u = new URL(destination);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return destination;
  }
}

/**
 * GET: all QStash schedules in the project tied to `QSTASH_TOKEN`.
 * POST: `{ scheduleId, action: "pause" | "resume" }` for any schedule returned by the QStash API (verified via list).
 */
export async function GET() {
  const auth = await requireSessionUser();
  if (auth) return auth;

  const token = process.env.QSTASH_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({
      ok: true as const,
      tokenConfigured: false,
      schedules: [] as UpstashScheduleListRow[],
    });
  }

  try {
    const client = new Client({ token });
    const list = await client.schedules.list();
    const schedules: UpstashScheduleListRow[] = list.map((sch) => {
      const destination = typeof sch.destination === "string" ? sch.destination : "";
      const rawLabel =
        "label" in sch && typeof (sch as { label?: unknown }).label === "string"
          ? ((sch as { label: string }).label as string).trim() || null
          : null;
      const scheduleId = sch.scheduleId;
      const displayName = rawLabel && rawLabel.length > 0 ? rawLabel : scheduleId;
      return {
        scheduleId,
        label: rawLabel,
        displayName,
        destination,
        path: pathFromDestination(destination),
        cron: typeof sch.cron === "string" ? sch.cron : null,
        isPaused: Boolean(sch.isPaused),
        managed: isManagedQstashScheduleId(scheduleId),
      };
    });
    schedules.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
    return NextResponse.json({ ok: true as const, tokenConfigured: true, schedules });
  } catch (e) {
    const message = e instanceof Error ? e.message : "qstash_list_failed";
    return NextResponse.json({ ok: false as const, error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const auth = await requireSessionUser();
  if (auth) return auth;

  let body: { scheduleId?: unknown; action?: unknown };
  try {
    body = (await request.json()) as { scheduleId?: unknown; action?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const scheduleId = typeof body.scheduleId === "string" ? body.scheduleId.trim() : "";
  const action = body.action === "pause" || body.action === "resume" ? body.action : null;
  if (!scheduleId || !action) {
    return NextResponse.json(
      { error: "invalid_body", hint: "Send JSON { scheduleId: string, action: \"pause\" | \"resume\" }." },
      { status: 400 },
    );
  }

  const token = process.env.QSTASH_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ error: "qstash_not_configured" }, { status: 501 });
  }

  try {
    const client = new Client({ token });
    const list = await client.schedules.list();
    const exists = list.some((s) => s.scheduleId === scheduleId);
    if (!exists) {
      return NextResponse.json({ error: "schedule_not_found" }, { status: 404 });
    }

    if (action === "pause") {
      await client.schedules.pause({ schedule: scheduleId });
    } else {
      await client.schedules.resume({ schedule: scheduleId });
    }
    return NextResponse.json({ ok: true as const, scheduleId, action });
  } catch (e) {
    const message = e instanceof Error ? e.message : "qstash_update_failed";
    return NextResponse.json({ ok: false as const, error: message }, { status: 502 });
  }
}
