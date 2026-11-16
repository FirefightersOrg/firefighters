-- SAN-11: atomic provisioning for admin-managed users.
--
-- Creating a user is two systems: Supabase Auth (auth.admin.createUser, an HTTP call) and
-- public tables. These functions make the public side ONE transaction: profile + role
-- assignments + audit_log row either all commit or none do. Trusted server code calls them with
-- the service-role client after creating the auth user; on error it deletes that auth user
-- (no profile exists to block the delete, because nothing was committed).
--
-- Both functions are service_role only. End users never call them directly; the API route
-- checks has_permission('user.manage') first.

-- Normalizes a list of role names (trim, dedupe, sort) and raises 22023 if any is empty or unknown.
create function public.admin_resolve_role_names(p_role_names text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_names text[];
  v_unknown text[];
begin
  if exists (
    select 1 from unnest(coalesce(p_role_names, array[]::text[])) as n
    where n is null or btrim(n) = ''
  ) then
    raise exception 'role names must not be empty' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(array_agg(distinct btrim(n) order by btrim(n)), array[]::text[])
  into v_names
  from unnest(coalesce(p_role_names, array[]::text[])) as n;

  select coalesce(array_agg(n order by n), array[]::text[])
  into v_unknown
  from unnest(v_names) as n
  where not exists (select 1 from public.roles r where r.name = n);

  if cardinality(v_unknown) > 0 then
    raise exception 'unknown role(s): %', array_to_string(v_unknown, ', ')
      using errcode = 'invalid_parameter_value';
  end if;

  return v_names;
end;
$$;

-- Creates the profile of an existing auth user, assigns roles and writes the 'user.create'
-- audit entry, atomically. The profile email is taken from auth.users so the mirror is exact.
-- p_actor_profile_id: acting admin's profiles.id, or null for system/seed actions.
--
-- Errors: 22023 invalid input / unknown role / inactive actor, P0002 auth user not found,
-- 23505 profile already exists for this auth user or email.
create function public.admin_provision_profile(
  p_auth_user_id uuid,
  p_full_name text,
  p_role_names text[],
  p_actor_profile_id uuid default null,
  p_request_id text default null,
  p_reason text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_role_names text[];
  v_profile public.profiles;
begin
  if p_auth_user_id is null then
    raise exception 'p_auth_user_id is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'full name is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_actor_profile_id is not null and not exists (
    select 1 from public.profiles p where p.id = p_actor_profile_id and p.status = 'active'
  ) then
    raise exception 'actor profile % is not an active profile', p_actor_profile_id
      using errcode = 'invalid_parameter_value';
  end if;

  v_role_names := public.admin_resolve_role_names(p_role_names);

  select lower(u.email) into v_email from auth.users u where u.id = p_auth_user_id;
  if not found then
    raise exception 'auth user % not found', p_auth_user_id using errcode = 'no_data_found';
  end if;
  if v_email is null then
    raise exception 'auth user % has no email', p_auth_user_id
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.profiles (auth_user_id, full_name, email, status)
  values (p_auth_user_id, btrim(p_full_name), v_email, 'active')
  returning * into v_profile;

  insert into public.user_roles (user_id, role_id)
  select v_profile.id, r.id
  from public.roles r
  where r.name = any (v_role_names);

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, new_value, reason, request_id)
  values (
    p_actor_profile_id,
    'user.create',
    'user',
    v_profile.id::text,
    jsonb_build_object(
      'id', v_profile.id,
      'auth_user_id', v_profile.auth_user_id,
      'email', v_profile.email,
      'full_name', v_profile.full_name,
      'status', v_profile.status,
      'roles', to_jsonb(v_role_names)
    ),
    coalesce(p_reason, 'Admin-managed user creation'),
    p_request_id
  );

  return v_profile;
end;
$$;

-- Assigns any of the given roles the profile does not have yet and writes one
-- 'user.roles.grant' audit entry (only when something changed), atomically.
-- Returns the role names that were newly granted (empty when nothing changed).
-- Used to repair half-provisioned users (e.g. by the seed script).
create function public.admin_grant_roles(
  p_profile_id uuid,
  p_role_names text[],
  p_actor_profile_id uuid default null,
  p_request_id text default null,
  p_reason text default null
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_names text[];
  v_before text[];
  v_granted text[];
begin
  if p_profile_id is null then
    raise exception 'p_profile_id is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_actor_profile_id is not null and not exists (
    select 1 from public.profiles p where p.id = p_actor_profile_id and p.status = 'active'
  ) then
    raise exception 'actor profile % is not an active profile', p_actor_profile_id
      using errcode = 'invalid_parameter_value';
  end if;

  v_role_names := public.admin_resolve_role_names(p_role_names);

  -- Lock the profile row so concurrent grants for the same user serialize.
  perform 1 from public.profiles p where p.id = p_profile_id for update;
  if not found then
    raise exception 'profile % not found', p_profile_id using errcode = 'no_data_found';
  end if;

  select coalesce(array_agg(r.name order by r.name), array[]::text[])
  into v_before
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = p_profile_id;

  with inserted as (
    insert into public.user_roles (user_id, role_id)
    select p_profile_id, r.id
    from public.roles r
    where r.name = any (v_role_names)
    on conflict (user_id, role_id) do nothing
    returning role_id
  )
  select coalesce(array_agg(r.name order by r.name), array[]::text[])
  into v_granted
  from inserted i
  join public.roles r on r.id = i.role_id;

  if cardinality(v_granted) > 0 then
    insert into public.audit_log
      (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
    values (
      p_actor_profile_id,
      'user.roles.grant',
      'user',
      p_profile_id::text,
      jsonb_build_object('roles', to_jsonb(v_before)),
      jsonb_build_object(
        'roles',
        (select to_jsonb(array_agg(distinct n order by n)) from unnest(v_before || v_granted) as n),
        'granted', to_jsonb(v_granted)
      ),
      coalesce(p_reason, 'Admin role grant'),
      p_request_id
    );
  end if;

  return v_granted;
end;
$$;

-- Internal helper: only the two functions above (running as owner) call it.
revoke all on function public.admin_resolve_role_names(text[])
  from public, anon, authenticated, service_role;

revoke all on function public.admin_provision_profile(uuid, text, text[], uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_provision_profile(uuid, text, text[], uuid, text, text)
  to service_role;

revoke all on function public.admin_grant_roles(uuid, text[], uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_grant_roles(uuid, text[], uuid, text, text)
  to service_role;
