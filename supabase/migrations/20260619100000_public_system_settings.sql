-- Generic app settings (cross-domain keys). Migrated from automation.settings.

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists system_settings_updated_idx on public.system_settings (updated_at desc);

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'automation' and table_name = 'settings'
  ) then
    insert into public.system_settings (key, value, updated_at)
    select s.key, s.value, s.updated_at
    from automation.settings s
    on conflict (key) do update
      set value = excluded.value,
          updated_at = excluded.updated_at;
  end if;
end $$;

-- Baselines if table was empty (or no automation.settings existed)
insert into public.system_settings (key, value)
values
  ('exchange_close_qstash_stagger_sec', '2'::jsonb),
  ('exchange_close_qstash_publish_concurrency', '32'::jsonb)
on conflict (key) do nothing;

drop table if exists automation.settings;

revoke all on table public.system_settings from public;
revoke all on table public.system_settings from anon, authenticated;
grant all on table public.system_settings to service_role;

alter table public.system_settings enable row level security;
