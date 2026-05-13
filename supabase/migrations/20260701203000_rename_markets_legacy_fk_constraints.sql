-- PostgREST embed hints use the FK constraint name on the referencing table.
-- `exchange_assets` was renamed to `markets` but legacy FK names were kept.

do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'catalog'
      and t.relname = 'markets'
      and c.conname = 'exchange_assets_asset_id_fkey'
  ) then
    alter table catalog.markets rename constraint exchange_assets_asset_id_fkey to markets_asset_id_fkey;
  end if;
end $$;
