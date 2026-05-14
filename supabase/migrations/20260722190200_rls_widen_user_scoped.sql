-- Widen SELECT on user-scoped reference tables so:
--   * users can read their own row,
--   * any authenticated user can read rows owned by the automation user,
--   * the automation user (when signed in) can read every row.
--
-- INSERT/UPDATE/DELETE policies are NOT touched.

-- public.user_preferences
drop policy if exists user_preferences_select on public.user_preferences;
create policy user_preferences_select on public.user_preferences
  for select to authenticated
  using (public.row_owner_visible(user_id));

-- public.user_profiles (was: only own row)
drop policy if exists user_profiles_select on public.user_profiles;
create policy user_profiles_select on public.user_profiles
  for select to authenticated
  using (public.row_owner_visible(user_id));

-- trading.user_execution_preferences (was: only own row)
drop policy if exists user_execution_preferences_select on trading.user_execution_preferences;
create policy user_execution_preferences_select on trading.user_execution_preferences
  for select to authenticated
  using (public.row_owner_visible(user_id));

-- public.logs (was: own row OR is_dashboard_administrator)
-- Keep admin escape hatch; add automation visibility on top.
drop policy if exists logs_select on public.logs;
create policy logs_select on public.logs
  for select to authenticated
  using (
    public.row_owner_visible(user_id)
    or public.is_dashboard_administrator()
  );
