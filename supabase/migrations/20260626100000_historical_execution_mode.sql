-- Enum extension only (must commit before CHECK constraints may reference the new label).

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    join pg_namespace n on t.typnamespace = n.oid
    where n.nspname = 'trading'
      and t.typname = 'execution_mode'
      and e.enumlabel = 'historical'
  ) then
    alter type trading.execution_mode add value 'historical';
  end if;
end $$;
