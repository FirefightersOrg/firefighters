-- SAN-12: permission functions, Row Level Security and append-only audit_log.
-- Policies evaluate granular permissions via has_permission(); role names are never hardcoded.

-- ---------------------------------------------------------------------------
-- Permission functions (single source of truth for authorization checks)
-- ---------------------------------------------------------------------------

-- Trusted-code entry point: answers for an arbitrary auth user. service_role only.
create or replace function public.has_permission_for_user(p_auth_user_id uuid, permission_code text)
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

-- End-user entry point: only answers for the caller (auth.uid()).
create or replace function public.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission_for_user((select auth.uid()), permission_code);
$$;

-- All permission codes held by the caller (auth.uid()); empty array when none.
create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct perm.code order by perm.code), array[]::text[])
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions perm on perm.id = rp.permission_id
  where p.auth_user_id = (select auth.uid())
    and p.status = 'active';
$$;

revoke all on function public.has_permission_for_user(uuid, text) from public, anon, authenticated;
grant execute on function public.has_permission_for_user(uuid, text) to service_role;

revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated, service_role;

revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS (deny by default) and table privileges
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;

-- anon gets nothing; authenticated gets the minimum base privileges RLS builds on.
revoke all on table
  public.profiles, public.roles, public.permissions,
  public.role_permissions, public.user_roles, public.audit_log
from anon;

revoke all on table
  public.profiles, public.roles, public.permissions,
  public.role_permissions, public.user_roles, public.audit_log
from authenticated;

grant select, insert, update, delete on table
  public.profiles, public.roles, public.permissions,
  public.role_permissions, public.user_roles
to authenticated;

grant select, insert on table public.audit_log to authenticated;

-- service_role bypasses RLS but still needs explicit base privileges (the revokes above
-- remove the defaults); audit_log stays insert/select only for it.
grant select, insert, update, delete on table
  public.profiles, public.roles, public.permissions,
  public.role_permissions, public.user_roles
to service_role;

grant select, insert on table public.audit_log to service_role;

-- ---------------------------------------------------------------------------
-- Policies (all `to authenticated`; no policy exists for anon)
-- ---------------------------------------------------------------------------

-- profiles
create policy profiles_select on public.profiles
  for select to authenticated
  using (auth_user_id = (select auth.uid()) or public.has_permission('user.manage'));

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (public.has_permission('user.manage'));

create policy profiles_update on public.profiles
  for update to authenticated
  using (public.has_permission('user.manage'))
  with check (public.has_permission('user.manage'));

create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.has_permission('user.manage'));

-- roles
create policy roles_select on public.roles
  for select to authenticated
  using (true);

create policy roles_insert on public.roles
  for insert to authenticated
  with check (public.has_permission('user.manage'));

create policy roles_update on public.roles
  for update to authenticated
  using (public.has_permission('user.manage'))
  with check (public.has_permission('user.manage'));

create policy roles_delete on public.roles
  for delete to authenticated
  using (public.has_permission('user.manage'));

-- permissions
create policy permissions_select on public.permissions
  for select to authenticated
  using (true);

create policy permissions_insert on public.permissions
  for insert to authenticated
  with check (public.has_permission('user.manage'));

create policy permissions_update on public.permissions
  for update to authenticated
  using (public.has_permission('user.manage'))
  with check (public.has_permission('user.manage'));

create policy permissions_delete on public.permissions
  for delete to authenticated
  using (public.has_permission('user.manage'));

-- role_permissions: readable for the caller's own roles or with user.manage
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (
    public.has_permission('user.manage')
    or role_id in (
      select ur.role_id
      from public.user_roles ur
      join public.profiles p on p.id = ur.user_id
      where p.auth_user_id = (select auth.uid())
    )
  );

create policy role_permissions_insert on public.role_permissions
  for insert to authenticated
  with check (public.has_permission('user.manage'));

create policy role_permissions_update on public.role_permissions
  for update to authenticated
  using (public.has_permission('user.manage'))
  with check (public.has_permission('user.manage'));

create policy role_permissions_delete on public.role_permissions
  for delete to authenticated
  using (public.has_permission('user.manage'));

-- user_roles: readable for the caller's own profile or with user.manage
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (
    public.has_permission('user.manage')
    or user_id in (
      select p.id from public.profiles p where p.auth_user_id = (select auth.uid())
    )
  );

create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check (public.has_permission('user.manage'));

create policy user_roles_update on public.user_roles
  for update to authenticated
  using (public.has_permission('user.manage'))
  with check (public.has_permission('user.manage'));

create policy user_roles_delete on public.user_roles
  for delete to authenticated
  using (public.has_permission('user.manage'));

-- audit_log: insert only as oneself, select with audit.view, no update/delete policies
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.has_permission('audit.view'));

create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (
    actor_user_id in (
      select p.id
      from public.profiles p
      where p.auth_user_id = (select auth.uid())
        and p.status = 'active'
    )
  );

-- ---------------------------------------------------------------------------
-- audit_log is append-only: revoked privileges + triggers
-- (service_role bypasses RLS and table owners bypass privileges, so triggers are the backstop)
-- ---------------------------------------------------------------------------

revoke update, delete, truncate on table public.audit_log from anon, authenticated, service_role;

create or replace function public.audit_log_forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The only tolerated change: the ON DELETE SET NULL foreign key action that detaches
  -- an actor when its profile is removed. It runs as a nested (referential integrity)
  -- trigger and may only null out actor_user_id; direct updates are always rejected.
  if tg_op = 'UPDATE'
     and pg_trigger_depth() > 1
     and new.actor_user_id is null
     and (to_jsonb(new) - 'actor_user_id') = (to_jsonb(old) - 'actor_user_id') then
    return new;
  end if;

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
