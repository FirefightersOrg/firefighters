-- SAN-12: permission functions, Row Level Security and append-only audit_log.
-- Policies evaluate granular permissions via has_permission(); role names are never hardcoded.
-- RLS itself is enabled (deny by default) in SAN-10.

-- ---------------------------------------------------------------------------
-- Identity and permission functions (single source of truth for authorization checks)
-- ---------------------------------------------------------------------------

-- The caller's (auth.uid()) profile id, or null when there is no ACTIVE profile.
-- Every policy that needs "my profile" goes through this helper.
create function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
    and p.status = 'active';
$$;

-- Trusted-code entry point: answers for an arbitrary auth user. service_role only.
create function public.has_permission_for_user(p_auth_user_id uuid, permission_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions perm on perm.id = rp.permission_id
    where p.auth_user_id = p_auth_user_id
      and p.status = 'active'
      and perm.code = permission_code
  );
$$;

-- All permission codes held by the caller (auth.uid()); empty array when none or inactive.
create function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct perm.code order by perm.code), array[]::text[])
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions perm on perm.id = rp.permission_id
  where ur.user_id = public.current_profile_id();
$$;

-- End-user entry point: only answers for the caller (auth.uid()).
-- In policies always call it as `(select public.has_permission(...))` so it runs once per
-- statement (initPlan) instead of once per row.
create function public.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select permission_code = any (public.my_permissions());
$$;

revoke all on function public.current_profile_id() from public, anon;
grant execute on function public.current_profile_id() to authenticated, service_role;

revoke all on function public.has_permission_for_user(uuid, text) from public, anon, authenticated;
grant execute on function public.has_permission_for_user(uuid, text) to service_role;

revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated, service_role;

revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
-- Supabase grants ALL (incl. TRUNCATE/TRIGGER/REFERENCES) to anon, authenticated and
-- service_role by default. Revoke everything and grant back only what each role needs.
-- The catalog (roles, permissions, role_permissions) is read-only at runtime for every
-- API role: it changes only through migrations (see 20261023000857_seed_roles_permissions.sql).

revoke all on table
  public.profiles, public.roles, public.permissions,
  public.role_permissions, public.user_roles, public.audit_log
from anon, authenticated, service_role;

-- authenticated: base privileges that RLS policies build on.
grant select on table public.roles, public.permissions, public.role_permissions to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.user_roles to authenticated;
-- audit_log: id and created_at are server-controlled and cannot be supplied by clients.
grant select on table public.audit_log to authenticated;
grant insert (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  on table public.audit_log to authenticated;

-- service_role (trusted server code; bypasses RLS).
-- profiles keeps DELETE only for the user-creation compensation path (see docs/data-model.md);
-- audit actors and role assignments still block deletes through ON DELETE RESTRICT FKs.
grant select on table public.roles, public.permissions, public.role_permissions to service_role;
grant select, insert, update, delete on table public.profiles, public.user_roles to service_role;
grant select, insert on table public.audit_log to service_role;

-- ---------------------------------------------------------------------------
-- Policies (all `to authenticated`; no policy exists for anon)
-- ---------------------------------------------------------------------------

-- profiles: own row is always readable (also when inactive, so login can report the status).
-- No delete policy: profiles are deactivated with status = 'inactive', never hard-deleted.
create policy profiles_select on public.profiles
  for select to authenticated
  using (auth_user_id = (select auth.uid()) or (select public.has_permission('user.manage')));

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check ((select public.has_permission('user.manage')));

create policy profiles_update on public.profiles
  for update to authenticated
  using ((select public.has_permission('user.manage')))
  with check ((select public.has_permission('user.manage')));

-- roles / permissions: readable catalog, no write policies (migrations only).
create policy roles_select on public.roles
  for select to authenticated
  using (true);

create policy permissions_select on public.permissions
  for select to authenticated
  using (true);

-- role_permissions: readable for the caller's own roles or with user.manage; no write policies.
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (
    (select public.has_permission('user.manage'))
    or role_id in (
      select ur.role_id from public.user_roles ur where ur.user_id = (select public.current_profile_id())
    )
  );

-- user_roles: readable for the caller's own active profile or with user.manage.
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (
    (select public.has_permission('user.manage'))
    or user_id = (select public.current_profile_id())
  );

create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check ((select public.has_permission('user.manage')));

create policy user_roles_update on public.user_roles
  for update to authenticated
  using ((select public.has_permission('user.manage')))
  with check ((select public.has_permission('user.manage')));

create policy user_roles_delete on public.user_roles
  for delete to authenticated
  using ((select public.has_permission('user.manage')));

-- audit_log: insert only as one's own active profile, select with audit.view,
-- no update/delete policies.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select public.has_permission('audit.view')));

create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (actor_user_id = (select public.current_profile_id()));

-- ---------------------------------------------------------------------------
-- audit_log: server-controlled timestamp and append-only enforcement
-- (service_role bypasses RLS and table owners bypass privileges, so triggers are the backstop)
-- ---------------------------------------------------------------------------

create function public.audit_log_set_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Entries can never be backdated or postdated, whoever inserts them.
  new.created_at := now();
  return new;
end;
$$;

revoke all on function public.audit_log_set_created_at() from public, anon, authenticated;

create trigger audit_log_set_created_at
  before insert on public.audit_log
  for each row execute function public.audit_log_set_created_at();

create function public.audit_log_forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Actors reference profiles with ON DELETE RESTRICT, so no FK action ever rewrites a row.
  raise exception 'audit_log is append-only: % is not allowed', tg_op
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.audit_log_forbid_mutation() from public, anon, authenticated;

create trigger audit_log_forbid_update_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_forbid_mutation();

create trigger audit_log_forbid_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_forbid_mutation();

-- ---------------------------------------------------------------------------
-- Lockout guard: never leave zero active profiles holding user.manage
-- ---------------------------------------------------------------------------
-- Fires (for every role, including service_role and migrations) when a change removes
-- user.manage from an active profile: deleting/changing its user_roles row, deactivating
-- the profile, or removing user.manage from one of its roles. AFTER ROW triggers run at
-- the end of the statement, so the check sees the statement's full effect. Changes that
-- did not remove a holder are never blocked (e.g. before the first admin exists).

create function public.guard_last_user_manage_holder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_holder boolean := false;
begin
  if tg_table_name = 'user_roles' then
    removed_holder := exists (
      select 1
      from public.profiles p
      join public.role_permissions rp on rp.role_id = old.role_id
      join public.permissions perm on perm.id = rp.permission_id
      where p.id = old.user_id
        and p.status = 'active'
        and perm.code = 'user.manage'
    );
  elsif tg_table_name = 'profiles' then
    removed_holder := old.status = 'active'
      and new.status is distinct from 'active'
      and exists (
        select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
        join public.permissions perm on perm.id = rp.permission_id
        where ur.user_id = old.id
          and perm.code = 'user.manage'
      );
  elsif tg_table_name = 'role_permissions' then
    removed_holder := exists (
        select 1 from public.permissions perm
        where perm.id = old.permission_id and perm.code = 'user.manage'
      )
      and exists (
        select 1
        from public.user_roles ur
        join public.profiles p on p.id = ur.user_id
        where ur.role_id = old.role_id
          and p.status = 'active'
      );
  end if;

  if removed_holder and not exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions perm on perm.id = rp.permission_id
    where p.status = 'active'
      and perm.code = 'user.manage'
  ) then
    raise exception 'at least one active profile must keep the user.manage permission'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

revoke all on function public.guard_last_user_manage_holder() from public, anon, authenticated;

create trigger user_roles_guard_last_user_manage_holder
  after update or delete on public.user_roles
  for each row execute function public.guard_last_user_manage_holder();

create trigger profiles_guard_last_user_manage_holder
  after update of status on public.profiles
  for each row execute function public.guard_last_user_manage_holder();

create trigger role_permissions_guard_last_user_manage_holder
  after update or delete on public.role_permissions
  for each row execute function public.guard_last_user_manage_holder();
