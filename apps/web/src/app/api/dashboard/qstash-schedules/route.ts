import { Client } from "@upstash/qstash";
import { createClient } from "@/lib/supabase/server";
import { isManagedQstashScheduleId, MANAGED_QSTASH_SCHEDULES } from "@/lib/workers/qstash-managed-schedules";
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

/**
 * GET: list Upstash QStash schedule state for Trade Agent managed schedules (pause/active, exists).
 * POST: `{ "scheduleId", "action": "pause" | "resume" }` for a managed schedule only.
 */
export async function GET() {
  const auth = await requireSessionUser();
  if (auth) return auth;

  const token = process.env.QSTASH_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({
      ok: true,
      tokenConfigured: false,
      schedules: MANAGED_QSTASH_SCHEDULES.map(({ scheduleId, jobKey }) => ({
        scheduleId,
        jobKey,
        exists: false,
        isPaused: null as boolean | null,
        cron: null as string | null,
      })),
    });
  }

  try {
    const client = new Client({ token });
    const list = await client.schedules.list();
    const byId = new Map(list.map((s) => [s.scheduleId, s]));
    const schedules = MANAGED_QSTASH_SCHEDULES.map(({ scheduleId, jobKey }) => {
      const sch = byId.get(scheduleId);
      if (!sch) {
        return { scheduleId, jobKey, exists: false, isPaused: null as boolean | null, cron: null as string | null };
      }
      return {
        scheduleId,
        jobKey,
        exists: true,
        isPaused: sch.isPaused,
        cron: sch.cron ?? null,
      };
    });
    return NextResponse.json({ ok: true, tokenConfigured: true, schedules });
  } catch (e) {
    const message = e instanceof Error ? e.message : "qstash_list_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
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
  if (!isManagedQstashScheduleId(scheduleId)) {
    return NextResponse.json({ error: "unknown_schedule" }, { status: 400 });
  }

  const token = process.env.QSTASH_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ error: "qstash_not_configured" }, { status: 501 });
  }

  try {
    const client = new Client({ token });
    if (action === "pause") {
      await client.schedules.pause({ schedule: scheduleId });
    } else {
      await client.schedules.resume({ schedule: scheduleId });
    }
    return NextResponse.json({ ok: true, scheduleId, action });
  } catch (e) {
    const message = e instanceof Error ? e.message : "qstash_update_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
