-- Remove legacy text quote after app + SQL use quote_asset_id only.

drop index if exists catalog.markets_quote_idx;

alter table catalog.markets drop column if exists quote_code;
