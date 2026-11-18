-- SAN-49: collectors and buyers, their links from bonds / commission_rules, RLS and audited
-- write functions.
--
-- Same model as campaigns and commission rules:
--   * authenticated can only SELECT. Every write goes through a SECURITY DEFINER function that
--     checks collector.manage / buyer.manage and writes the change plus its audit_log row in one
--     transaction.
--   * Collectors and buyers are never deleted (they are referenced by bonds, sales and history):
--     a collector is deactivated (status inactive); DELETE/TRUNCATE are rejected for every role.
--   * Both are global, not per campaign: the same person sells / buys year after year. The
--     screens are reached from a campaign, but the records span campaigns.
--
-- Decisions:
--   * Text fields are stored trimmed; empty strings become null (the functions normalise them,
--     CHECK constraints are the backstop).
--   * A collector may be linked to one profile (user_profile_id, unique) for the future collector
--     login ("own" scope): that profile can read its own collector row without collector.view.
--   * Buyers: an individual needs a first or last name; a business needs business_name.
--     document_number and tax_id are indexed (partial) but NOT unique: legacy data has duplicate
--     buyers that are normalised by hand (docs/migration.md), so the screens warn instead.
--   * Reading needs X.view OR X.manage (SAN-93 gives every action permission its .view; this
--     keeps working in either merge order).
--
-- Errors (SQLSTATE):
--   42501 insufficient_privilege   no active profile, or missing collector.manage / buyer.manage
--   22023 invalid_parameter_value  bad input (missing name, unknown status/type, bad email,
--                                  field too long, unknown profile)
--   P0002 no_data_found            collector / buyer / usual collector not found
--   23505 unique_violation         profile already linked to another collector
--   PT409 (HTTP 409)               optimistic concurrency on *_update (p_expected_updated_at)
--   23001 restrict_violation       change to id / created_*; delete / truncate

-- ---------------------------------------------------------------------------
-- collectors
-- ---------------------------------------------------------------------------
create table public.collectors (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  phone text,
  email text,
  address text,
  -- Future collector login: the profile whose own portfolio this is.
  user_profile_id uuid references public.profiles (id) on delete restrict,
  status text not null default 'active',
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint collectors_display_name_valid
    check (btrim(display_name) <> '' and display_name = btrim(display_name) and char_length(display_name) <= 200),
  constraint collectors_phone_valid
    check (btrim(phone) <> '' and phone = btrim(phone) and char_length(phone) <= 50),
  constraint collectors_email_valid
    check (email = btrim(email) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint collectors_address_valid
    check (btrim(address) <> '' and address = btrim(address) and char_length(address) <= 500),
  constraint collectors_status_check check (status in ('active', 'inactive'))
);

comment on table public.collectors is
  'Collectors / sellers (SAN-49). Global across campaigns; never deleted, deactivated instead.';
comment on column public.collectors.user_profile_id is
  'Profile of the collector''s own login (future "own" scope). Unique when set.';

create unique index collectors_user_profile_key on public.collectors (user_profile_id)
  where user_profile_id is not null;
create index collectors_status_name_idx on public.collectors (status, display_name);
create index collectors_created_by_idx on public.collectors (created_by);

-- ---------------------------------------------------------------------------
-- buyers
-- ---------------------------------------------------------------------------
create table public.buyers (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  first_name text,
  last_name text,
  business_name text,
  document_number text,
  tax_id text,
  phone text,
  address text,
  usual_collector_id uuid references public.collectors (id) on delete restrict,
  notes text,
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint buyers_type_check check (type in ('individual', 'business')),
  constraint buyers_name_by_type check (
    case type
      when 'individual' then coalesce(first_name, last_name) is not null
      else business_name is not null
    end
  ),
  constraint buyers_first_name_valid
    check (btrim(first_name) <> '' and first_name = btrim(first_name) and char_length(first_name) <= 100),
  constraint buyers_last_name_valid
    check (btrim(last_name) <> '' and last_name = btrim(last_name) and char_length(last_name) <= 100),
  constraint buyers_business_name_valid
    check (btrim(business_name) <> '' and business_name = btrim(business_name) and char_length(business_name) <= 200),
  constraint buyers_document_number_valid
    check (btrim(document_number) <> '' and document_number = btrim(document_number) and char_length(document_number) <= 30),
  constraint buyers_tax_id_valid
    check (btrim(tax_id) <> '' and tax_id = btrim(tax_id) and char_length(tax_id) <= 30),
  constraint buyers_phone_valid
    check (btrim(phone) <> '' and phone = btrim(phone) and char_length(phone) <= 50),
  constraint buyers_address_valid
    check (btrim(address) <> '' and address = btrim(address) and char_length(address) <= 500),
  -- Trimmed at both ends like every other field (inner line breaks are kept).
  constraint buyers_notes_valid
    check (btrim(notes) <> '' and notes = btrim(notes) and char_length(notes) <= 2000)
);

comment on table public.buyers is
  'Buyers of bonds (SAN-49): individuals or businesses. Global across campaigns; never deleted.';
comment on column public.buyers.document_number is
  'DNI or similar (individuals). Indexed, not unique: legacy duplicates are normalised by hand.';
comment on column public.buyers.tax_id is
  'CUIT/CUIL (mostly businesses). Indexed, not unique.';

create index buyers_document_number_idx on public.buyers (document_number)
  where document_number is not null;
create index buyers_tax_id_idx on public.buyers (tax_id) where tax_id is not null;
create index buyers_usual_collector_idx on public.buyers (usual_collector_id)
  where usual_collector_id is not null;
create index buyers_created_by_idx on public.buyers (created_by);

-- ---------------------------------------------------------------------------
-- Links created earlier without a target table
-- ---------------------------------------------------------------------------
alter table public.bonds
  add constraint bonds_current_collector_fkey foreign key (current_collector_id)
    references public.collectors (id) on delete restrict,
  add constraint bonds_current_buyer_fkey foreign key (current_buyer_id)
    references public.buyers (id) on delete restrict;

alter table public.commission_rules
  add constraint commission_rules_applies_to_collector_fkey foreign key (applies_to_collector_id)
    references public.collectors (id) on delete restrict;

create index bonds_current_buyer_idx on public.bonds (current_buyer_id)
  where current_buyer_id is not null;
create index commission_rules_applies_to_collector_idx on public.commission_rules (applies_to_collector_id)
  where applies_to_collector_id is not null;

-- ---------------------------------------------------------------------------
-- Write guards (all roles): immutable identity, managed timestamps, no deletion
-- ---------------------------------------------------------------------------
create function public.collectors_buyers_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception '%.id, created_by and created_at cannot be changed', tg_table_name
      using errcode = 'restrict_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create function public.collectors_buyers_forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are never deleted', tg_table_name using errcode = 'restrict_violation';
end;
$$;

create trigger collectors_guard_write before insert or update on public.collectors
  for each row execute function public.collectors_buyers_guard_write();
create trigger buyers_guard_write before insert or update on public.buyers
  for each row execute function public.collectors_buyers_guard_write();
create trigger collectors_forbid_delete before delete on public.collectors
  for each row execute function public.collectors_buyers_forbid_delete();
create trigger collectors_forbid_truncate before truncate on public.collectors
  for each statement execute function public.collectors_buyers_forbid_delete();
create trigger buyers_forbid_delete before delete on public.buyers
  for each row execute function public.collectors_buyers_forbid_delete();
create trigger buyers_forbid_truncate before truncate on public.buyers
  for each statement execute function public.collectors_buyers_forbid_delete();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Trimmed text, null when empty; 22023 when longer than p_max.
create function public.party_text(p_value text, p_label text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(p_value), '');
begin
  if char_length(v) > p_max then
    raise exception '% must be at most % characters', p_label, p_max
      using errcode = 'invalid_parameter_value';
  end if;
  return v;
end;
$$;

create function public.party_require_actor(p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if v_actor is null then
    raise exception 'an active profile is required' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_permission(p_permission) then
    raise exception 'permission denied: % is required', p_permission
      using errcode = 'insufficient_privilege';
  end if;
  return v_actor;
end;
$$;

-- Audit diff: only the keys that changed (both sides).
create function public.party_audit_diff(p_old jsonb, p_new jsonb, out old_value jsonb, out new_value jsonb)
language sql
immutable
set search_path = ''
as $$
  select
    (select jsonb_object_agg(o.key, o.value) from jsonb_each(p_old) o
      where o.value is distinct from p_new -> o.key),
    (select jsonb_object_agg(n.key, n.value) from jsonb_each(p_new) n
      where n.value is distinct from p_old -> n.key);
$$;

create function public.collector_audit_snapshot(p public.collectors)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('display_name', p.display_name, 'phone', p.phone, 'email', p.email,
    'address', p.address, 'user_profile_id', p.user_profile_id, 'status', p.status);
$$;

create function public.buyer_audit_snapshot(p public.buyers)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('type', p.type, 'first_name', p.first_name, 'last_name', p.last_name,
    'business_name', p.business_name, 'document_number', p.document_number, 'tax_id', p.tax_id,
    'phone', p.phone, 'address', p.address, 'usual_collector_id', p.usual_collector_id,
    'notes', p.notes);
$$;

-- Validated collector fields, as a row (id/created_* unset).
create function public.collector_validate(
  p_display_name text, p_phone text, p_email text, p_address text, p_user_profile_id uuid,
  p_status text
)
returns public.collectors
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.collectors;
begin
  v.display_name := public.party_text(p_display_name, 'display name', 200);
  if v.display_name is null then
    raise exception 'a display name is required' using errcode = 'invalid_parameter_value';
  end if;
  v.phone := public.party_text(p_phone, 'phone', 50);
  v.email := lower(public.party_text(p_email, 'email', 254));
  if v.email is not null and v.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'email is not valid' using errcode = 'invalid_parameter_value';
  end if;
  v.address := public.party_text(p_address, 'address', 500);
  v.status := coalesce(nullif(btrim(p_status), ''), 'active');
  if v.status not in ('active', 'inactive') then
    raise exception 'invalid collector status: %', v.status using errcode = 'invalid_parameter_value';
  end if;
  if p_user_profile_id is not null
     and not exists (select 1 from public.profiles where id = p_user_profile_id) then
    raise exception 'profile % not found', p_user_profile_id using errcode = 'invalid_parameter_value';
  end if;
  v.user_profile_id := p_user_profile_id;
  return v;
end;
$$;

-- Validated buyer fields, as a row. The usual collector must exist (any status: a buyer may keep
-- an inactive usual collector as history).
create function public.buyer_validate(
  p_type text, p_first_name text, p_last_name text, p_business_name text, p_document_number text,
  p_tax_id text, p_phone text, p_address text, p_usual_collector_id uuid, p_notes text
)
returns public.buyers
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.buyers;
begin
  v.type := nullif(btrim(p_type), '');
  if v.type is null or v.type not in ('individual', 'business') then
    raise exception 'buyer type must be individual or business' using errcode = 'invalid_parameter_value';
  end if;
  v.first_name := public.party_text(p_first_name, 'first name', 100);
  v.last_name := public.party_text(p_last_name, 'last name', 100);
  v.business_name := public.party_text(p_business_name, 'business name', 200);
  v.document_number := public.party_text(p_document_number, 'document number', 30);
  v.tax_id := public.party_text(p_tax_id, 'tax id', 30);
  v.phone := public.party_text(p_phone, 'phone', 50);
  v.address := public.party_text(p_address, 'address', 500);
  v.notes := public.party_text(p_notes, 'notes', 2000);
  if v.type = 'individual' and coalesce(v.first_name, v.last_name) is null then
    raise exception 'an individual buyer needs a first or last name' using errcode = 'invalid_parameter_value';
  end if;
  if v.type = 'business' and v.business_name is null then
    raise exception 'a business buyer needs a business name' using errcode = 'invalid_parameter_value';
  end if;
  if p_usual_collector_id is not null
     and not exists (select 1 from public.collectors where id = p_usual_collector_id) then
    raise exception 'usual collector % not found', p_usual_collector_id using errcode = 'no_data_found';
  end if;
  v.usual_collector_id := p_usual_collector_id;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Collector write functions
-- ---------------------------------------------------------------------------
create function public.collector_create(
  p_display_name text,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_user_profile_id uuid default null,
  p_status text default 'active',
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.party_require_actor('collector.manage');
  v public.collectors;
begin
  v := public.collector_validate(p_display_name, p_phone, p_email, p_address, p_user_profile_id, p_status);
  insert into public.collectors (display_name, phone, email, address, user_profile_id, status, created_by)
  values (v.display_name, v.phone, v.email, v.address, v.user_profile_id, v.status, v_actor)
  returning * into v;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'collector.create', 'collector', v.id::text, public.collector_audit_snapshot(v), p_request_id);
  return v.id;
end;
$$;

-- Full replacement of the editable fields. Returns false for a no-op (nothing written).
create function public.collector_update(
  p_id uuid,
  p_display_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_user_profile_id uuid,
  p_status text,
  p_expected_updated_at timestamptz,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.party_require_actor('collector.manage');
  v_old public.collectors;
  v_new public.collectors;
  v public.collectors;
  v_diff record;
begin
  select * into v_old from public.collectors where id = p_id for update;
  if not found then
    raise exception 'collector % not found', p_id using errcode = 'no_data_found';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'collector was modified by someone else' using errcode = 'PT409',
      hint = 'reload the collector and apply the change again';
  end if;
  -- No status means "keep it": an update must never reactivate a collector by omission.
  v := public.collector_validate(p_display_name, p_phone, p_email, p_address, p_user_profile_id,
    coalesce(nullif(btrim(p_status), ''), v_old.status));
  if public.collector_audit_snapshot(v) = public.collector_audit_snapshot(v_old) then
    return false;
  end if;
  update public.collectors
  set display_name = v.display_name, phone = v.phone, email = v.email, address = v.address,
      user_profile_id = v.user_profile_id, status = v.status
  where id = p_id
  returning * into v_new;
  select * into v_diff from public.party_audit_diff(
    public.collector_audit_snapshot(v_old), public.collector_audit_snapshot(v_new));
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, request_id)
  values (v_actor, 'collector.update', 'collector', p_id::text, v_diff.old_value, v_diff.new_value, p_request_id);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Buyer write functions
-- ---------------------------------------------------------------------------
create function public.buyer_create(
  p_type text,
  p_first_name text default null,
  p_last_name text default null,
  p_business_name text default null,
  p_document_number text default null,
  p_tax_id text default null,
  p_phone text default null,
  p_address text default null,
  p_usual_collector_id uuid default null,
  p_notes text default null,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.party_require_actor('buyer.manage');
  v public.buyers;
begin
  v := public.buyer_validate(p_type, p_first_name, p_last_name, p_business_name, p_document_number,
    p_tax_id, p_phone, p_address, p_usual_collector_id, p_notes);
  insert into public.buyers (type, first_name, last_name, business_name, document_number, tax_id,
    phone, address, usual_collector_id, notes, created_by)
  values (v.type, v.first_name, v.last_name, v.business_name, v.document_number, v.tax_id,
    v.phone, v.address, v.usual_collector_id, v.notes, v_actor)
  returning * into v;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'buyer.create', 'buyer', v.id::text, public.buyer_audit_snapshot(v), p_request_id);
  return v.id;
end;
$$;

create function public.buyer_update(
  p_id uuid,
  p_type text,
  p_first_name text,
  p_last_name text,
  p_business_name text,
  p_document_number text,
  p_tax_id text,
  p_phone text,
  p_address text,
  p_usual_collector_id uuid,
  p_notes text,
  p_expected_updated_at timestamptz,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.party_require_actor('buyer.manage');
  v_old public.buyers;
  v_new public.buyers;
  v public.buyers;
  v_diff record;
begin
  select * into v_old from public.buyers where id = p_id for update;
  if not found then
    raise exception 'buyer % not found', p_id using errcode = 'no_data_found';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'buyer was modified by someone else' using errcode = 'PT409',
      hint = 'reload the buyer and apply the change again';
  end if;
  v := public.buyer_validate(p_type, p_first_name, p_last_name, p_business_name, p_document_number,
    p_tax_id, p_phone, p_address, p_usual_collector_id, p_notes);
  if public.buyer_audit_snapshot(v) = public.buyer_audit_snapshot(v_old) then
    return false;
  end if;
  update public.buyers
  set type = v.type, first_name = v.first_name, last_name = v.last_name,
      business_name = v.business_name, document_number = v.document_number, tax_id = v.tax_id,
      phone = v.phone, address = v.address, usual_collector_id = v.usual_collector_id,
      notes = v.notes
  where id = p_id
  returning * into v_new;
  select * into v_diff from public.party_audit_diff(
    public.buyer_audit_snapshot(v_old), public.buyer_audit_snapshot(v_new));
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, request_id)
  values (v_actor, 'buyer.update', 'buyer', p_id::text, v_diff.old_value, v_diff.new_value, p_request_id);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
revoke all on table public.collectors from anon, authenticated, service_role;
revoke all on table public.buyers from anon, authenticated, service_role;
grant select on table public.collectors to authenticated;
grant select on table public.buyers to authenticated;
-- service_role (server-side maintenance, tests) reads and writes, but the triggers still apply.
grant select, insert, update on table public.collectors to service_role;
grant select, insert, update on table public.buyers to service_role;

alter table public.collectors enable row level security;
alter table public.buyers enable row level security;

create policy collectors_select on public.collectors
  for select to authenticated
  using (
    (select public.has_permission('collector.view'))
    or (select public.has_permission('collector.manage'))
    -- "own" scope: the collector's own login reads its own row.
    or (user_profile_id is not null and user_profile_id = (select public.current_profile_id()))
  );

create policy buyers_select on public.buyers
  for select to authenticated
  using ((select public.has_permission('buyer.view')) or (select public.has_permission('buyer.manage')));

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.collectors_buyers_guard_write()', 'public.collectors_buyers_forbid_delete()',
    'public.party_text(text, text, integer)', 'public.party_require_actor(text)',
    'public.party_audit_diff(jsonb, jsonb)', 'public.collector_audit_snapshot(public.collectors)',
    'public.buyer_audit_snapshot(public.buyers)',
    'public.collector_validate(text, text, text, text, uuid, text)',
    'public.buyer_validate(text, text, text, text, text, text, text, text, uuid, text)',
    'public.collector_create(text, text, text, text, uuid, text, text)',
    'public.collector_update(uuid, text, text, text, text, uuid, text, timestamptz, text)',
    'public.buyer_create(text, text, text, text, text, text, text, text, uuid, text, text)',
    'public.buyer_update(uuid, text, text, text, text, text, text, text, text, uuid, text, timestamptz, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end;
$$;

grant execute on function public.collector_create(text, text, text, text, uuid, text, text) to authenticated;
grant execute on function public.collector_update(uuid, text, text, text, text, uuid, text, timestamptz, text) to authenticated;
grant execute on function public.buyer_create(text, text, text, text, text, text, text, text, uuid, text, text) to authenticated;
grant execute on function public.buyer_update(uuid, text, text, text, text, text, text, text, text, uuid, text, timestamptz, text) to authenticated;

comment on function public.collector_create(text, text, text, text, uuid, text, text) is
  'Creates a collector (collector.manage), audited as collector.create. Returns its id.';
comment on function public.collector_update(uuid, text, text, text, text, uuid, text, timestamptz, text) is
  'Replaces a collector''s fields (collector.manage, optimistic concurrency), audited with the changed keys.';
comment on function public.buyer_create(text, text, text, text, text, text, text, text, uuid, text, text) is
  'Creates a buyer (buyer.manage), audited as buyer.create. Returns its id.';
comment on function public.buyer_update(uuid, text, text, text, text, text, text, text, text, uuid, text, timestamptz, text) is
  'Replaces a buyer''s fields (buyer.manage, optimistic concurrency), audited with the changed keys.';
