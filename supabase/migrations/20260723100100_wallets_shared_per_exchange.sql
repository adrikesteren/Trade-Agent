-- P1/M2 — Shared exchange wallets for live/paper executors; isolated per-executor wallet for historical.
--
-- Before: trading.wallets had one row per executor (unique on executor_id).
-- After:
--   * kind='shared_exchange'   → one wallet per (user_id, exchange_id), shared across that user's live + paper executors.
--   * kind='historical_paper'  → one wallet per executor (kept for historical replay isolation).
--
-- The trigger trg_executors_create_wallet picks shared vs historical based on execution_mode.
-- Existing wallets are consolidated per (user, exchange) for non-historical executors.

-- ---------------------------------------------------------------------------
-- 1) Enum + new columns
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'trading' and t.typname = 'wallet_kind'
  ) then
    create type trading.wallet_kind as enum ('shared_exchange', 'historical_paper');
  end if;
end $$;

alter table trading.wallets
  add column if not exists exchange_id uuid references catalog.exchanges (id) on delete restrict,
  add column if not exists kind trading.wallet_kind;

comment on column trading.wallets.kind is
  'shared_exchange = one wallet per (user, exchange) shared by paper+live executors. historical_paper = one wallet per historical executor (isolated replay).';
comment on column trading.wallets.exchange_id is
  'Catalog exchange this wallet belongs to. Required for both shared_exchange and historical_paper kinds.';

-- ---------------------------------------------------------------------------
-- 2) Backfill exchange_id + kind from current 1:1 (executor_id) rows
-- ---------------------------------------------------------------------------
update trading.wallets w
set
  exchange_id = e.exchange_id,
  kind = case
           when e.execution_mode = 'historical'::trading.execution_mode then 'historical_paper'::trading.wallet_kind
           else 'shared_exchange'::trading.wallet_kind
         end
from trading.executors e
where w.executor_id = e.id
  and (w.exchange_id is null or w.kind is null);

-- ---------------------------------------------------------------------------
-- 3) Consolidate non-historical wallets per (user, exchange)
--    For each (user, exchange) group with shared_exchange kind:
--      * pick the OLDEST wallet as the keeper
--      * re-parent wallet_transactions of sibling wallets to the keeper
--      * sum wallet_asset_balance.amount onto the keeper (or insert), then drop sibling balance rows
--      * point sibling executors' wallet_id to the keeper, then delete sibling wallets
--      * insert an audit deposit (quantity 0) so the merge is visible in the ledger
-- ---------------------------------------------------------------------------
do $$
declare
  rec record;
  keeper_id uuid;
  sibling_id uuid;
  sibling_user uuid;
  any_eur uuid;
begin
  -- Pick any EUR asset id for the audit row when present (fallback to NULL when missing).
  select a.id into any_eur
  from catalog.assets a
  where a.kind = 'fiat'::public.asset_kind
    and upper(trim(a.code)) = 'EUR'
  order by a.created_at asc nulls last
  limit 1;

  for rec in
    select user_id, exchange_id
    from trading.wallets
    where kind = 'shared_exchange'::trading.wallet_kind
      and exchange_id is not null
    group by user_id, exchange_id
    having count(*) > 1
  loop
    select id into keeper_id
    from trading.wallets
    where user_id = rec.user_id
      and exchange_id = rec.exchange_id
      and kind = 'shared_exchange'::trading.wallet_kind
    order by created_at asc, id asc
    limit 1;

    for sibling_id, sibling_user in
      select id, user_id
      from trading.wallets
      where user_id = rec.user_id
        and exchange_id = rec.exchange_id
        and kind = 'shared_exchange'::trading.wallet_kind
        and id <> keeper_id
    loop
      -- Re-parent ledger rows
      update trading.wallet_transactions
      set wallet_id = keeper_id
      where wallet_id = sibling_id;

      -- Merge wallet_asset_balance: sum sibling amount onto keeper row (insert when keeper has none)
      with sib_bal as (
        select asset_id, amount
        from trading.wallet_asset_balance
        where wallet_id = sibling_id
      )
      insert into trading.wallet_asset_balance (wallet_id, asset_id, amount)
      select keeper_id, asset_id, amount
      from sib_bal
      on conflict (wallet_id, asset_id) do update
        set amount = trading.wallet_asset_balance.amount + excluded.amount,
            updated_at = now();

      delete from trading.wallet_asset_balance where wallet_id = sibling_id;

      -- Point any executors that still reference the sibling at the keeper
      update trading.executors
      set wallet_id = keeper_id
      where wallet_id = sibling_id;

      -- Delete the sibling wallet (executor_id will be detached after we relax the unique index below)
      delete from trading.wallets where id = sibling_id;

      -- Audit row in the keeper's ledger so the merge is visible
      if any_eur is not null then
        insert into trading.wallet_transactions (
          user_id, wallet_id, asset_id, kind, quantity, ref_order_id, note
        ) values (
          sibling_user,
          keeper_id,
          any_eur,
          'deposit'::trading.wallet_transaction_kind,
          0,
          null,
          'consolidated from wallet ' || sibling_id::text
        );
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Drop the legacy 1:1 unique on executor_id (constraint + index forms),
--    then add the new partial unique indexes for the two wallet kinds.
-- ---------------------------------------------------------------------------
alter table trading.wallets drop constraint if exists wallets_executor_uidx;
drop index if exists trading.wallets_executor_uidx;

-- Detach historical wallets from executors that no longer match the kind
-- (covered above; keep the column for historical_paper rows).

create unique index if not exists wallets_user_exchange_shared_uidx
  on trading.wallets (user_id, exchange_id)
  where kind = 'shared_exchange'::trading.wallet_kind;

create unique index if not exists wallets_executor_historical_uidx
  on trading.wallets (executor_id)
  where kind = 'historical_paper'::trading.wallet_kind
    and executor_id is not null;

-- Free up shared wallets to be unattached from a single executor
alter table trading.wallets alter column executor_id drop not null;

-- Make the new typing real once backfill ran
alter table trading.wallets alter column exchange_id set not null;
alter table trading.wallets alter column kind set not null;

-- ---------------------------------------------------------------------------
-- 5) Re-point every non-historical executor at the shared wallet for its (user, exchange)
-- ---------------------------------------------------------------------------
update trading.executors e
set wallet_id = w.id
from trading.wallets w
where w.user_id = e.user_id
  and w.exchange_id = e.exchange_id
  and w.kind = 'shared_exchange'::trading.wallet_kind
  and e.execution_mode <> 'historical'::trading.execution_mode
  and (e.wallet_id is distinct from w.id);

-- And ensure historical executors keep pointing to their isolated wallet
update trading.executors e
set wallet_id = w.id
from trading.wallets w
where w.executor_id = e.id
  and w.kind = 'historical_paper'::trading.wallet_kind
  and (e.wallet_id is distinct from w.id);

-- For non-historical executors that never had a wallet (pre-trigger or freshly inserted with no shared wallet yet),
-- ensure one shared_exchange wallet exists per (user, exchange) and point them at it.
do $$
declare
  rec record;
  wid uuid;
begin
  for rec in
    select distinct e.user_id, e.exchange_id
    from trading.executors e
    where e.execution_mode <> 'historical'::trading.execution_mode
      and not exists (
        select 1 from trading.wallets w
        where w.user_id = e.user_id
          and w.exchange_id = e.exchange_id
          and w.kind = 'shared_exchange'::trading.wallet_kind
      )
  loop
    insert into trading.wallets (user_id, executor_id, exchange_id, kind)
    values (rec.user_id, null, rec.exchange_id, 'shared_exchange'::trading.wallet_kind)
    returning id into wid;

    update trading.executors e
    set wallet_id = wid
    where e.user_id = rec.user_id
      and e.exchange_id = rec.exchange_id
      and e.execution_mode <> 'historical'::trading.execution_mode
      and (e.wallet_id is null or e.wallet_id is distinct from wid);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6) Update create-wallet trigger: shared per (user, exchange) for paper/live; per-executor for historical
-- ---------------------------------------------------------------------------
create or replace function trading.trg_executors_create_wallet()
returns trigger
language plpgsql
security definer
set search_path = trading, public
as $$
declare
  v_wid uuid;
begin
  if new.execution_mode = 'historical'::trading.execution_mode then
    -- Isolated per-executor wallet for historical replay
    select id into v_wid
    from trading.wallets
    where executor_id = new.id
      and kind = 'historical_paper'::trading.wallet_kind
    limit 1;

    if v_wid is null then
      insert into trading.wallets (user_id, executor_id, exchange_id, kind)
      values (
        new.user_id,
        new.id,
        new.exchange_id,
        'historical_paper'::trading.wallet_kind
      )
      returning id into v_wid;
    end if;
  else
    -- Shared wallet per (user, exchange)
    select id into v_wid
    from trading.wallets
    where user_id = new.user_id
      and exchange_id = new.exchange_id
      and kind = 'shared_exchange'::trading.wallet_kind
    limit 1;

    if v_wid is null then
      insert into trading.wallets (user_id, executor_id, exchange_id, kind)
      values (
        new.user_id,
        null,
        new.exchange_id,
        'shared_exchange'::trading.wallet_kind
      )
      returning id into v_wid;
    end if;
  end if;

  update trading.executors set wallet_id = v_wid where id = new.id;
  return new;
end;
$$;

revoke all on function trading.trg_executors_create_wallet() from public;

-- ---------------------------------------------------------------------------
-- 7) RLS: widen wallet SELECT to also allow access by user_id (shared wallets have nullable executor_id)
-- ---------------------------------------------------------------------------
drop policy if exists wallets_select on trading.wallets;
create policy wallets_select on trading.wallets
  for select to authenticated
  using (
    public.row_owner_visible(user_id)
    or (
      executor_id is not null
      and exists (
        select 1 from trading.executors e
        where e.id = wallets.executor_id
          and public.row_owner_visible(e.user_id)
      )
    )
  );

drop policy if exists wallet_transactions_select on trading.wallet_transactions;
create policy wallet_transactions_select on trading.wallet_transactions
  for select to authenticated
  using (
    public.row_owner_visible(user_id)
    or exists (
      select 1 from trading.wallets w
      where w.id = wallet_transactions.wallet_id
        and public.row_owner_visible(w.user_id)
    )
  );

drop policy if exists wallet_asset_balance_select on trading.wallet_asset_balance;
create policy wallet_asset_balance_select on trading.wallet_asset_balance
  for select to authenticated
  using (
    exists (
      select 1 from trading.wallets w
      where w.id = wallet_asset_balance.wallet_id
        and public.row_owner_visible(w.user_id)
    )
  );
