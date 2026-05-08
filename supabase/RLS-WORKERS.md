# RLS and workers (service role)

## `bitvavo_sync_status`

Dashboard-only metadata: **last successful** manual or worker run for Bitvavo markets/candles (EUR). **Read** for `authenticated`; **writes** via service role from API routes after sync.

## Global market catalog (`exchanges`, `assets`, `markets`, `candles`)

These tables hold **shared** reference data (not per-user). **RLS** allows any `authenticated` user to **read** them; **writes** are intended to go through the **service role** (sync route `/api/markets/bitvavo/sync`, ingest worker) so the app can bulk-upsert without per-row `user_id`.

**Realtime:** `public.candles` is included in the `supabase_realtime` publication (see migration `20250512120000_enable_realtime_candles.sql`). Subscribers only receive changes for rows they are allowed to `SELECT` under RLS.

## Authenticated users (Next.js dashboard)

The web app uses the **anon key** with the user session. **Row Level Security (RLS)** on most `public.*` trading tables restricts reads and writes to rows where `user_id = auth.uid()`.

## Workers and API routes (`SUPABASE_SERVICE_ROLE_KEY`)

Background jobs (QStash → `/api/workers/*`) use `createServiceRoleClient()` with the **service role** key. That client **bypasses RLS**.

**Rule:** every worker handler must:

1. Authenticate the **caller** (e.g. verify QStash signature on the request).
2. Treat `userId` / `connectorId` in the job payload as trusted **only after** that caller check.
3. Scope every query and mutation with those IDs (never take `user_id` from unsigned client input).

If you prefer RLS for workers too, use `SECURITY DEFINER` RPCs with explicit checks instead of ad hoc service-role writes.

## Files

- SQL migrations: [migrations/](migrations/)
- Service role helper (server-only): `apps/web/src/lib/supabase/admin.ts`
- Scheduled Bitvavo EUR candle sweep (updates `bitvavo_candles_eur`): `apps/web/src/app/api/workers/bitvavo-candles-sync/route.ts`
