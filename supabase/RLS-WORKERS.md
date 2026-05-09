# RLS and workers (service role)

## `sync_runs`

Append-only **sync run** rows per `job_key` (e.g. Bitvavo markets EUR, candles EUR). **Read** for `authenticated`; **insert/update** via service role from API routes / workers (`record-bitvavo-sync-status`, candle sweep).

**Realtime:** `automation.sync_runs` is included in `supabase_realtime` (migration `20260519120000_enable_realtime_sync_runs.sql`) so the dashboard Sync runs page can subscribe to INSERT/UPDATE without refresh.

**Overlap:** For `trigger_source = automated`, `beginBitvavoSyncRun` (app) inserts `skipped` with `reason = 'Previous sync still running'` when a row for the same `job_key` is already `running`, so schedulers do not stack concurrent runs. Manual triggers still start a new `running` row.

## Global market catalog (`exchanges`, `assets`, `markets`, `candles`, `candle_timestamps`)

These tables hold **shared** reference data (not per-user). **RLS** allows any `authenticated` user to **read** them; **writes** are intended to go through the **service role** (Bitvavo catalog sync routes, candle workers, CoinGecko metrics worker) so the app can bulk-upsert without per-row `user_id`.

**Realtime:** `catalog.candles` is included in the `supabase_realtime` publication (initial migration targeted `public.candles`; after the catalog schema split, migration `20260518100000_candle_timestamps_failed_reason_realtime.sql` adds `catalog.candles` when missing). Subscribers only receive changes for rows they are allowed to `SELECT` under RLS.

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
