-- Standard fields (created_by, updated_by, updated_at) for the high-volume / append-only
-- tables modeled as `HighVolumeObjectMetadata`. NO `name` column is added (the storage
-- overhead of a text column on tables with millions of rows is not worth the marginal UX
-- win). The `updated_at` trigger is installed only on tables that can be mutated after
-- insert; truly append-only tables get the column for shape consistency but no trigger.
--
-- For tables that already have a `user_id`, `created_by` is back-filled from it so the
-- audit trail isn't blank.

-- public.logs (append-only)
alter table public.logs
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();
update public.logs set created_by = user_id where created_by is null and user_id is not null;

-- catalog.candles (append-only)
alter table catalog.candles
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

-- catalog.candle_timestamps (status field can change → install updated_at trigger)
alter table catalog.candle_timestamps
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();
drop trigger if exists trg_candle_timestamps_set_updated_at on catalog.candle_timestamps;
create trigger trg_candle_timestamps_set_updated_at
  before update on catalog.candle_timestamps
  for each row execute function public.set_updated_at_now();

-- trading.signals (append-only)
alter table trading.signals
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();
update trading.signals set created_by = user_id where created_by is null and user_id is not null;

-- automation.signal_jobs (status changes → install updated_at trigger)
alter table automation.signal_jobs
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();
drop trigger if exists trg_signal_jobs_set_updated_at on automation.signal_jobs;
create trigger trg_signal_jobs_set_updated_at
  before update on automation.signal_jobs
  for each row execute function public.set_updated_at_now();

-- automation.signal_runs (status changes → install updated_at trigger; needs created_at)
alter table automation.signal_runs
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();
drop trigger if exists trg_signal_runs_set_updated_at on automation.signal_runs;
create trigger trg_signal_runs_set_updated_at
  before update on automation.signal_runs
  for each row execute function public.set_updated_at_now();

-- automation.schedule_runs (status changes → install updated_at trigger)
alter table automation.schedule_runs
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();
drop trigger if exists trg_schedule_runs_set_updated_at on automation.schedule_runs;
create trigger trg_schedule_runs_set_updated_at
  before update on automation.schedule_runs
  for each row execute function public.set_updated_at_now();

-- automation.sync_runs (already has updated_at; ensure trigger present)
alter table automation.sync_runs
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);
drop trigger if exists trg_sync_runs_set_updated_at on automation.sync_runs;
create trigger trg_sync_runs_set_updated_at
  before update on automation.sync_runs
  for each row execute function public.set_updated_at_now();

-- trading.wallet_transactions (append-only ledger)
alter table trading.wallet_transactions
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();
update trading.wallet_transactions set created_by = user_id where created_by is null and user_id is not null;

-- trading.fills (append-only ledger)
alter table trading.fills
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();
update trading.fills set created_by = user_id where created_by is null and user_id is not null;

-- trading.executor_moving_floors (floor updates → install updated_at trigger)
alter table trading.executor_moving_floors
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);
drop trigger if exists trg_executor_moving_floors_set_updated_at on trading.executor_moving_floors;
create trigger trg_executor_moving_floors_set_updated_at
  before update on trading.executor_moving_floors
  for each row execute function public.set_updated_at_now();
update trading.executor_moving_floors set created_by = user_id where created_by is null and user_id is not null;

-- trading.executor_historical_runs (status changes → install updated_at trigger; needs created_at)
alter table trading.executor_historical_runs
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();
drop trigger if exists trg_executor_historical_runs_set_updated_at on trading.executor_historical_runs;
create trigger trg_executor_historical_runs_set_updated_at
  before update on trading.executor_historical_runs
  for each row execute function public.set_updated_at_now();
update trading.executor_historical_runs set created_by = user_id where created_by is null and user_id is not null;
