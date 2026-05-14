-- Schema-agnostic visibility helper for "automated_process can see all + every user can see
-- automation-owned rows". This is a SELECT-only contract: callers should still gate
-- INSERT/UPDATE/DELETE through stricter policies. Mirrors the body of
-- public.trading_row_accessible(uuid) but is intentionally named so it can be reused
-- outside the trading schema (logs, user_preferences, automation, …).

create or replace function public.row_owner_visible(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = p_user_id
      or public.is_catalog_automated_process_user(p_user_id)
      or public.is_catalog_automated_process_user(auth.uid());
$$;

revoke all on function public.row_owner_visible(uuid) from public;
grant execute on function public.row_owner_visible(uuid) to authenticated, service_role;
