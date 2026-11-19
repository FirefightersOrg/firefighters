-- SAN-102: new functions in schema public are not executable by anyone but their owner unless a
-- migration grants it explicitly.
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and Supabase adds default privileges
-- that also grant it to anon, authenticated and service_role. Every migration used to have to
-- revoke those by hand; a missed revoke exposed the function through PostgREST. From this
-- migration on, a new RPC needs an explicit
--   grant execute on function public.<name>(<args>) to authenticated;
-- (or service_role) to be callable at all.
--
-- Scope and limits:
-- - Only `postgres` is targeted: migrations run as `postgres`, and every function in public is
--   owned by it. `postgres` is not a superuser and not a member of `supabase_admin`, so it cannot
--   alter `supabase_admin`'s default privileges (`must be member of role`); functions created by
--   `supabase_admin` (platform internals, not our migrations) keep the platform defaults.
-- - Default privileges only affect objects created afterwards. Functions that already exist keep
--   their current ACLs, which every earlier migration already set explicitly.
-- - Idempotent: re-running it (or running it on a stack whose image already revokes these) is a
--   no-op.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

do $$
declare
  v_acl aclitem[];
begin
  select d.defaclacl into v_acl
  from pg_default_acl d
  where d.defaclrole = 'postgres'::regrole
    and d.defaclnamespace = 'public'::regnamespace
    and d.defaclobjtype = 'f';

  if v_acl is null then
    raise exception 'default privileges for postgres functions in public were not recorded';
  end if;

  if exists (
    select 1
    from aclexplode(v_acl) a
    where a.privilege_type = 'EXECUTE'
      and a.grantee <> 'postgres'::regrole
  ) then
    raise exception 'default privileges still grant EXECUTE on new public functions: %', v_acl;
  end if;
end;
$$;
