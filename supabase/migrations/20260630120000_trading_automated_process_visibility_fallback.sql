-- Broader detection of "catalog automation" trading rows so any signed-in user can SELECT them
-- (same policies as 20260628130100; only the helper body changes).
--
-- Fixes:
-- - username match is case-insensitive / trimmed (profiles must not break visibility).
-- - if `automation_actor` row is missing or key drifted, still recognize the seeded auth user by email.

create or replace function public.is_catalog_automated_process_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.automation_actor aa
      where aa.key = 'automated_process'
        and aa.user_id is not null
        and aa.user_id = p_user_id
    )
    or exists (
      select 1
      from public.user_profiles up
      where up.user_id = p_user_id
        and lower(trim(coalesce(up.username, ''))) = 'automated_process'
    )
    or exists (
      select 1
      from auth.users au
      where au.id = p_user_id
        and lower(coalesce(au.email, '')) = 'automated-process@system.invalid'
    ),
    false
  );
$$;

revoke all on function public.is_catalog_automated_process_user(uuid) from public;
grant execute on function public.is_catalog_automated_process_user(uuid) to authenticated, service_role;
