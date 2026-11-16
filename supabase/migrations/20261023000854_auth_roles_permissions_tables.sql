-- SAN-10: tables for authentication, roles, granular permissions and the audit log.
-- RLS is enabled here (deny by default); policies and permission functions are added in SAN-12.
--
-- Profiles are never hard-deleted: users are deactivated through profiles.status = 'inactive'
-- (and banned in Supabase Auth). Every FK that points at a profile or auth user is therefore
-- ON DELETE RESTRICT so history (role assignments, audit actors) cannot be lost or rewritten.

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  full_name text not null,
  -- Mirror of auth.users.email, kept in sync by profiles_sync_email_from_auth below.
  -- Uniqueness is case-insensitive via profiles_email_lower_key.
  email text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

create unique index profiles_email_lower_key on public.profiles (lower(email));

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null
);

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create index role_permissions_permission_id_idx on public.role_permissions (permission_id);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete restrict,
  role_id uuid not null references public.roles (id) on delete restrict,
  primary key (user_id, role_id)
);

create index user_roles_role_id_idx on public.user_roles (role_id);

-- Append-only enforcement is added in SAN-12. actor_user_id is nullable for system actions.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles (id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now(),
  request_id text
);

create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_actor_user_id_idx on public.audit_log (actor_user_id);
create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_request_id_idx on public.audit_log (request_id);

-- Deny by default until SAN-12 adds policies. service_role bypasses RLS.
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;

-- Keep profiles.email in sync when a user changes their email through Supabase Auth.
create function public.profiles_sync_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = new.email
  where auth_user_id = new.id;
  return new;
end;
$$;

revoke all on function public.profiles_sync_email_from_auth() from public, anon, authenticated;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email and new.email is not null)
  execute function public.profiles_sync_email_from_auth();
