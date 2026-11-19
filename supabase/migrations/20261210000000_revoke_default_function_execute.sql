-- SAN-102: new functions in schema public are not executable by anyone but their owner unless a
-- migration grants it explicitly.
--
-- Postgres grants EXECUTE on every new function to PUBLIC (a built-in global default), and
-- Supabase stacks may add schema defaults that also grant it to anon, authenticated and
-- service_role. Every migration used to have to revoke those by hand; a missed revoke exposed the
-- function through PostgREST. From this migration on, a new RPC needs an explicit
--   grant execute on function public.<name>(<args>) to authenticated;
-- (or service_role) to be callable at all.
--
-- Why two statements: per-schema default privileges can only ADD to the global ones, never take
-- away from them. A schema-level `revoke ... from public` is a no-op while the built-in global
-- default still grants EXECUTE to PUBLIC, and anon/authenticated/service_role inherit it through
-- PUBLIC. So PUBLIC is revoked globally (every schema, functions created by postgres) and the API
-- roles are revoked in public.
--
-- Scope and limits:
-- - Only `postgres` is targeted: migrations run as `postgres`, and every function in public is
--   owned by it. `postgres` is not a superuser and not a member of `supabase_admin`, so it cannot
--   alter `supabase_admin`'s default privileges (`must be member of role`). Functions created by
--   `supabase_admin` (platform internals and extensions such as btree_gist, which supautils
--   installs as supabase_admin) keep the platform defaults.
-- - The global revoke also applies to functions postgres creates in other schemas. Our
--   migrations only create functions in public today; the per-schema grants Supabase defines
--   (for example in storage) still apply on top of it.
-- - Default privileges only affect objects created afterwards. Functions that already exist keep
--   their current ACLs, which every earlier migration already set explicitly.
-- - Idempotent.
alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

do $$
begin
  -- Global default for postgres functions: an entry must exist (the built-in default is
  -- owner + PUBLIC) and grant EXECUTE to nobody but the owner.
  if not exists (
    select 1
    from pg_default_acl d
    where d.defaclrole = 'postgres'::regrole
      and d.defaclnamespace = 0
      and d.defaclobjtype = 'f'
  ) then
    raise exception 'global default privileges for postgres functions were not recorded';
  end if;

  if exists (
    select 1
    from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole
      and d.defaclnamespace in (0, 'public'::regnamespace)
      and d.defaclobjtype = 'f'
      and a.privilege_type = 'EXECUTE'
      and a.grantee <> 'postgres'::regrole
  ) then
    raise exception 'default privileges still grant EXECUTE on new public functions';
  end if;
end;
$$;
