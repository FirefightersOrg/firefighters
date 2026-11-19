-- SAN-96: make the last user.manage holder guard safe under concurrent changes.
--
-- guard_last_user_manage_holder() (20261023001500_rls_has_permission.sql) checked each change in
-- its own transaction: two admins removing each other in parallel could both pass the check and
-- leave no active user.manage holder. The guard now takes a transaction-level advisory lock with
-- a stable key before it looks at the holders, so these changes run one after the other.
--
-- The lock is taken on every guarded row change (user_roles update/delete, profiles status
-- update, role_permissions update/delete), not only on the ones that remove a holder: all three
-- tables change rarely, and deciding "removes a holder" before the lock could use a stale view.
--
-- The guard relies on READ COMMITTED (the default, also for PostgREST): a REPEATABLE READ
-- transaction keeps its first snapshot after waiting for the lock and would not see the other
-- transaction's change.

create or replace function public.guard_last_user_manage_holder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_holder boolean := false;
begin
  -- Serialize every change that may remove a holder (SAN-96). Without this, two transactions
  -- that each remove one of the last two holders both see the other holder as still active and
  -- both commit. The lock is held until the end of the transaction, so the second one waits for
  -- the first to commit or roll back. Under READ COMMITTED each statement below then takes a new
  -- snapshot and sees the first transaction's committed change.
  perform pg_advisory_xact_lock(hashtextextended('guard_last_user_manage_holder', 0));

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

-- Trigger function: never callable through the API (create or replace keeps the existing
-- grants; restated here so this migration does not depend on 20261128000000).
revoke all on function public.guard_last_user_manage_holder()
  from public, anon, authenticated, service_role;
