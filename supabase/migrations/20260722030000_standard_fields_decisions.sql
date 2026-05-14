-- Standard fields + auto-name (DEC-{0000}) for trading.decisions
-- (renamed from trading.trade_decisions in 20260714100000_wallets_replace_ledger_risk_decisions.sql).

alter table trading.decisions
  add column if not exists name       text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

create sequence if not exists trading.decisions_name_seq;

create or replace function trading.set_decisions_auto_name()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or new.name = '' then
    new.name := public.format_auto_name('DEC-', 4, nextval('trading.decisions_name_seq'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_decisions_auto_name on trading.decisions;
create trigger trg_decisions_auto_name
  before insert on trading.decisions
  for each row execute function trading.set_decisions_auto_name();

drop trigger if exists trg_decisions_set_updated_at on trading.decisions;
create trigger trg_decisions_set_updated_at
  before update on trading.decisions
  for each row execute function public.set_updated_at_now();

-- Backfill: assign DEC-0001, DEC-0002, ... in chronological order.
with ordered as (
  select id, row_number() over (order by created_at, id) as rn
    from trading.decisions
   where name is null or name = ''
)
update trading.decisions t
   set name = public.format_auto_name('DEC-', 4, ordered.rn)
  from ordered
 where t.id = ordered.id;

select setval(
  'trading.decisions_name_seq',
  greatest((select count(*)::bigint from trading.decisions), 1)
);

alter table trading.decisions alter column name set not null;

-- Pre-populate created_by from user_id (no historical actor data; user_id is the closest signal).
update trading.decisions set created_by = user_id where created_by is null;
