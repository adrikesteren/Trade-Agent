-- Standard fields + auto-name (WAL-{0000}) for trading.wallets.

alter table trading.wallets
  add column if not exists name       text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

create sequence if not exists trading.wallets_name_seq;

create or replace function trading.set_wallets_auto_name()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or new.name = '' then
    new.name := public.format_auto_name('WAL-', 4, nextval('trading.wallets_name_seq'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wallets_auto_name on trading.wallets;
create trigger trg_wallets_auto_name
  before insert on trading.wallets
  for each row execute function trading.set_wallets_auto_name();

drop trigger if exists trg_wallets_set_updated_at on trading.wallets;
create trigger trg_wallets_set_updated_at
  before update on trading.wallets
  for each row execute function public.set_updated_at_now();

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
    from trading.wallets
   where name is null or name = ''
)
update trading.wallets t
   set name = public.format_auto_name('WAL-', 4, ordered.rn)
  from ordered
 where t.id = ordered.id;

select setval(
  'trading.wallets_name_seq',
  greatest((select count(*)::bigint from trading.wallets), 1)
);

alter table trading.wallets alter column name set not null;

update trading.wallets set created_by = user_id where created_by is null;
