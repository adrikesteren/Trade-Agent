-- candle_timestamps (master) + candles.candle_timestamp_id (detail, ON DELETE CASCADE)
-- sync_runs.failed_reason required when status = failed
-- Realtime: ensure catalog.candles is in supabase_realtime publication

-- ---------------------------------------------------------------------------
-- A. catalog.candle_timestamps
-- ---------------------------------------------------------------------------
create table catalog.candle_timestamps (
  id uuid primary key default gen_random_uuid(),
  open_time timestamptz not null,
  close_time timestamptz not null,
  created_at timestamptz not null default now(),
  unique (open_time, close_time)
);

create index candle_timestamps_close_time_idx on catalog.candle_timestamps (close_time);

alter table catalog.candle_timestamps enable row level security;

create policy candle_timestamps_select_all
  on catalog.candle_timestamps
  for select
  to authenticated
  using (true);

grant select on catalog.candle_timestamps to authenticated;
grant all on catalog.candle_timestamps to service_role;

-- ---------------------------------------------------------------------------
-- B. catalog.candles: FK column, backfill, swap unique, drop open/close
-- ---------------------------------------------------------------------------
alter table catalog.candles
  add column if not exists candle_timestamp_id uuid;

insert into catalog.candle_timestamps (open_time, close_time)
select distinct c.open_time, c.close_time
from catalog.candles c
where c.candle_timestamp_id is null
on conflict (open_time, close_time) do nothing;

update catalog.candles c
set candle_timestamp_id = ct.id
from catalog.candle_timestamps ct
where c.candle_timestamp_id is null
  and c.open_time = ct.open_time
  and c.close_time = ct.close_time;

alter table catalog.candles
  alter column candle_timestamp_id set not null;

alter table catalog.candles
  add constraint candles_candle_timestamp_id_fkey
    foreign key (candle_timestamp_id) references catalog.candle_timestamps (id) on delete cascade;

alter table catalog.candles drop constraint if exists candles_market_timeframe_close_key;

alter table catalog.candles
  add constraint candles_market_timeframe_candle_timestamp_id_key
    unique (market_id, timeframe, candle_timestamp_id);

drop index if exists catalog.candles_close_time_idx;
drop index if exists catalog.candles_market_close_idx;

alter table catalog.candles drop column if exists open_time;
alter table catalog.candles drop column if exists close_time;

-- ---------------------------------------------------------------------------
-- C. automation.sync_runs.failed_reason
-- ---------------------------------------------------------------------------
alter table automation.sync_runs
  add column if not exists failed_reason text;

update automation.sync_runs
set failed_reason = coalesce(failed_reason, 'Legacy: not recorded')
where status = 'failed';

alter table automation.sync_runs
  drop constraint if exists sync_runs_failed_reason_when_failed;

alter table automation.sync_runs
  add constraint sync_runs_failed_reason_when_failed
    check (status <> 'failed' or failed_reason is not null);

comment on column automation.sync_runs.failed_reason is 'Required when status = failed; human-readable error.';

-- ---------------------------------------------------------------------------
-- D. Realtime publication for catalog.candles
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables pt
    where pt.pubname = 'supabase_realtime'
      and pt.schemaname = 'catalog'
      and pt.tablename = 'candles'
  ) then
    alter publication supabase_realtime add table catalog.candles;
  end if;
end $$;
