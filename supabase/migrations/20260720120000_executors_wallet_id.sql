-- Denormalized trading.executors.wallet_id = trading.wallets.id (1:1 per executor).
alter table trading.executors
  add column if not exists wallet_id uuid;

comment on column trading.executors.wallet_id is
  'Pointer to trading.wallets.id for this executor. Synced by trg_executors_create_wallet after executor insert; backfilled from wallets.';

update trading.executors e
set wallet_id = w.id
from trading.wallets w
where w.executor_id = e.id
  and e.wallet_id is distinct from w.id;

create unique index if not exists executors_wallet_id_uidx
  on trading.executors (wallet_id)
  where wallet_id is not null;

create or replace function trading.trg_executors_create_wallet()
returns trigger
language plpgsql
security definer
set search_path = trading, public
as $$
declare
  v_wid uuid;
begin
  select w.id into v_wid from trading.wallets w where w.executor_id = new.id limit 1;
  if v_wid is null then
    insert into trading.wallets (user_id, executor_id)
    values (new.user_id, new.id)
    returning id into v_wid;
  end if;
  update trading.executors set wallet_id = v_wid where id = new.id;
  return new;
end;
$$;
