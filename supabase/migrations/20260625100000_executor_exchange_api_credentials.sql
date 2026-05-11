-- Per-executor credentials for private exchange REST (Bitvavo v1). Empty strings allowed for paper-only executors; app enforces non-empty for live trading.

alter table trading.executors
  add column if not exists exchange_api_key text not null default '',
  add column if not exists exchange_api_secret text not null default '';

comment on column trading.executors.exchange_api_key is 'Access key for private exchange API calls (e.g. Bitvavo REST signing).';
comment on column trading.executors.exchange_api_secret is 'Signing secret for private exchange API calls. RLS: row owner only.';
