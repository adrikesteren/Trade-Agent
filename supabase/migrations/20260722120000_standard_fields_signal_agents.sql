-- Standard fields for trading.signal_agents (manual name; backfill from agent_id with a
-- human-friendly label for the seeded agents). `agent_id` stays as the stable programmatic
-- identifier (`unique`); `name` is the user-facing label.

alter table trading.signal_agents
  add column if not exists name       text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);

-- Backfill: known agent_id values get curated labels; everything else falls back to agent_id.
update trading.signal_agents
   set name = case
                when agent_id = 'ma_cross'      then 'MA Cross'
                when agent_id = 'rsi'           then 'RSI'
                when agent_id = 'breakout_atr'  then 'Breakout ATR'
                when agent_id = 'stub'          then 'Stub'
                else agent_id
              end
 where name is null or name = '';

drop trigger if exists trg_signal_agents_set_updated_at on trading.signal_agents;
create trigger trg_signal_agents_set_updated_at
  before update on trading.signal_agents
  for each row execute function public.set_updated_at_now();

alter table trading.signal_agents alter column name set not null;
