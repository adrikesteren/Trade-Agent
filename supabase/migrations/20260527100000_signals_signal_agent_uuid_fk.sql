-- trading.signals: reference signal_agents by primary key (uuid) instead of agent_id slug (text).
-- Enables dashboard links to /dashboard/signal-agents/[id] and matches typical FK ergonomics.

alter table trading.signals
  add column if not exists signal_agent_id uuid;

update trading.signals s
set signal_agent_id = a.id
from trading.signal_agents a
where a.agent_id = s.agent_id;

do $$
begin
  if exists (select 1 from trading.signals where signal_agent_id is null) then
    raise exception 'trading.signals: cannot map agent_id to signal_agents.id (orphan rows)';
  end if;
end $$;

alter table trading.signals drop constraint if exists signals_user_agent_market_timeframe_close_key;

alter table trading.signals drop column agent_id;

alter table trading.signals alter column signal_agent_id set not null;

alter table trading.signals
  add constraint signals_signal_agent_id_fkey
  foreign key (signal_agent_id) references trading.signal_agents (id) on delete restrict;

alter table trading.signals
  add constraint signals_user_signal_agent_market_timeframe_close_key
  unique (user_id, signal_agent_id, market_id, timeframe, close_time);
