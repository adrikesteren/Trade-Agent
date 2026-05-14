-- Widen SELECT on trading.wallets / wallet_transactions / wallet_asset_balance so:
--   * every authenticated user can read rows owned by the automation user, and
--   * the automation user (when signed in) can read every row.
-- INSERT/UPDATE/DELETE policies are NOT touched.

drop policy if exists wallets_select on trading.wallets;
create policy wallets_select on trading.wallets
  for select to authenticated
  using (
    public.row_owner_visible(user_id)
    and exists (
      select 1 from trading.executors e
      where e.id = wallets.executor_id
        and public.row_owner_visible(e.user_id)
    )
  );

drop policy if exists wallet_transactions_select on trading.wallet_transactions;
create policy wallet_transactions_select on trading.wallet_transactions
  for select to authenticated
  using (
    public.row_owner_visible(user_id)
    and exists (
      select 1 from trading.wallets w
      join trading.executors e on e.id = w.executor_id
      where w.id = wallet_transactions.wallet_id
        and public.row_owner_visible(e.user_id)
    )
  );

drop policy if exists wallet_asset_balance_select on trading.wallet_asset_balance;
create policy wallet_asset_balance_select on trading.wallet_asset_balance
  for select to authenticated
  using (
    exists (
      select 1
      from trading.wallets w
      join trading.executors e on e.id = w.executor_id
      where w.id = wallet_asset_balance.wallet_id
        and public.row_owner_visible(e.user_id)
    )
  );
