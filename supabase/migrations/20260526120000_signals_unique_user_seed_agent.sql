-- trading.signals: unique must include user_id (multi-tenant).
-- Replace any existing UNIQUE on (agent_id, market_id, timeframe, close_time).

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'trading'
      and t.relname = 'signals'
      and c.contype = 'u'
  loop
    execute format('alter table trading.signals drop constraint %I', r.conname);
  end loop;
end $$;

alter table trading.signals
  add constraint signals_user_agent_market_timeframe_close_key
  unique (user_id, agent_id, market_id, timeframe, close_time);

-- First rule-based catalog agent (v1 MA crossover on 5m closes).
insert into trading.signal_agents (agent_id, enabled, version, description, config, allowed_timeframes)
values (
  'ma-cross-5m-v1',
  true,
  '1',
  'Fast/slow simple moving average crossover on catalog storage timeframe closes; ENTER on bullish cross at bar close, else HOLD.',
  jsonb_build_object('fastPeriod', 9, 'slowPeriod', 21),
  array['5m']::text[]
)
on conflict (agent_id) do update
set
  enabled = excluded.enabled,
  version = excluded.version,
  description = excluded.description,
  config = excluded.config,
  allowed_timeframes = excluded.allowed_timeframes,
  updated_at = now();
