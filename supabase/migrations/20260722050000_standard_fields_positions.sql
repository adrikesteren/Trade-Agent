-- Standard fields + auto-name (POS-{0000}) for trading.positions.
-- Adds `created_at` (table only had `updated_at` previously).

alter table trading.positions
  add column if not exists name       text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id);

create sequence if not exists trading.positions_name_seq;

create or replace function trading.set_positions_auto_name()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or new.name = '' then
    new.name := public.format_auto_name('POS-', 4, nextval('trading.positions_name_seq'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_positions_auto_name on trading.positions;
create trigger trg_positions_auto_name
  before insert on trading.positions
  for each row execute function trading.set_positions_auto_name();

drop trigger if exists trg_positions_set_updated_at on trading.positions;
create trigger trg_positions_set_updated_at
  before update on trading.positions
  for each row execute function public.set_updated_at_now();

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
    from trading.positions
   where name is null or name = ''
)
update trading.positions t
   set name = public.format_auto_name('POS-', 4, ordered.rn)
  from ordered
 where t.id = ordered.id;

select setval(
  'trading.positions_name_seq',
  greatest((select count(*)::bigint from trading.positions), 1)
);

alter table trading.positions alter column name set not null;

update trading.positions set created_by = user_id where created_by is null;
