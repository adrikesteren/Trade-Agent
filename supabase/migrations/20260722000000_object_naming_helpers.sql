-- Reusable helpers for the AdriCore standard-field contract:
--   * public.set_updated_at_now()  — BEFORE UPDATE trigger that keeps `updated_at` fresh.
--   * public.format_auto_name(...) — formats a Salesforce-style auto-name (e.g. ORD-0001)
--     from a prefix + zero-padding + sequence value. Used by per-table auto-name triggers.
--
-- Per-table sequences + per-table BEFORE INSERT triggers are created in the migrations that
-- follow this one (one migration per table). Changing the prefix/padding of an auto-name
-- format is done by writing a new migration that `create or replace function` the per-table
-- trigger; existing rows are NOT renamed. See AGENTS.md.

create or replace function public.set_updated_at_now()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at_now() from public;
grant execute on function public.set_updated_at_now() to authenticated, service_role;

create or replace function public.format_auto_name(prefix text, padding int, n bigint)
returns text
language sql
immutable
as $$
  select prefix || lpad(n::text, padding, '0');
$$;

revoke all on function public.format_auto_name(text, int, bigint) from public;
grant execute on function public.format_auto_name(text, int, bigint) to authenticated, service_role;
