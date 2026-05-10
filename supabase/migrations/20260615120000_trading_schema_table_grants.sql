-- trading.* had RLS but no blanket table GRANTs for authenticated (unlike catalog/automation in split migration).
-- Without table privileges, PostgREST returns: permission denied for table …
--
-- Grant on every *existing* table in schema trading (idempotent with any per-table grants from later migrations).

grant select, insert, update, delete on all tables in schema trading to authenticated;
grant all on all tables in schema trading to service_role;

-- New tables created by future migrations (typically owned by postgres) inherit these defaults.
alter default privileges for role postgres in schema trading
  grant select, insert, update, delete on tables to authenticated;
alter default privileges for role postgres in schema trading
  grant all on tables to service_role;
