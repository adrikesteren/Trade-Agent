-- New enum label must be committed before any INSERT using it (PG 55P04).
-- Next migration seeds fiat assets and adds markets.quote_asset_id.

alter type public.asset_kind add value if not exists 'fiat';
