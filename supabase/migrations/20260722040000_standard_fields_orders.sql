-- Standard fields + auto-name (ORD-{0000}) for trading.orders.

alter table trading.orders
  add column if not exists name       text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);

create sequence if not exists trading.orders_name_seq;

create or replace function trading.set_orders_auto_name()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or new.name = '' then
    new.name := public.format_auto_name('ORD-', 4, nextval('trading.orders_name_seq'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_auto_name on trading.orders;
create trigger trg_orders_auto_name
  before insert on trading.orders
  for each row execute function trading.set_orders_auto_name();

drop trigger if exists trg_orders_set_updated_at on trading.orders;
create trigger trg_orders_set_updated_at
  before update on trading.orders
  for each row execute function public.set_updated_at_now();

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
    from trading.orders
   where name is null or name = ''
)
update trading.orders t
   set name = public.format_auto_name('ORD-', 4, ordered.rn)
  from ordered
 where t.id = ordered.id;

select setval(
  'trading.orders_name_seq',
  greatest((select count(*)::bigint from trading.orders), 1)
);

alter table trading.orders alter column name set not null;

update trading.orders set created_by = user_id where created_by is null;
