-- Tunable automation knobs (DB wins over process.env at read time in the app). No grants to authenticated;
-- the Next server uses the service role after verifying an Administrator session.

create table if not exists automation.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists system_settings_updated_idx on automation.system_settings (updated_at desc);

-- Baselines match previous code defaults in run-exchange-close-pipeline.ts
insert into automation.system_settings (key, value)
values
  ('exchange_close_qstash_stagger_sec', '2'::jsonb),
  ('exchange_close_qstash_publish_concurrency', '32'::jsonb)
on conflict (key) do nothing;

grant all on table automation.system_settings to service_role;
