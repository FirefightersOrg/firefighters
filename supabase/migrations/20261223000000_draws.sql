-- SAN-75: storage only; future audited SECURITY DEFINER RPCs own writes.
create table public.draws (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  draw_type text not null check (draw_type in ('monthly','extraordinary_full_payment','final','consolation')),
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 200),
  draw_date date not null,
  payment_cutoff_at timestamptz not null,
  required_installment_number integer check (required_installment_number >= 1),
  eligibility_rule jsonb not null default '{}'::jsonb check (jsonb_typeof(eligibility_rule) = 'object'),
  status text not null default 'scheduled' check (status in ('scheduled','roster_generated','roster_frozen','completed','closed','annulled')),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  annulled_at timestamptz,
  annulled_by uuid references public.profiles(id) on delete restrict,
  annul_reason text,
  constraint draws_monthly_installment check (draw_type <> 'monthly' or required_installment_number is not null),
  constraint draws_annulment_consistent check (
    (status = 'annulled' and annulled_at is not null and annulled_by is not null
      and annul_reason is not null and annul_reason = btrim(annul_reason)
      and annul_reason <> '' and char_length(annul_reason) <= 1000)
    or (status <> 'annulled' and annulled_at is null and annulled_by is null and annul_reason is null)
  )
);

create table public.draw_rosters (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references public.draws(id) on delete restrict,
  status text not null default 'generated' check (status in ('generated','frozen','superseded')),
  generated_at timestamptz not null default now(),
  generated_by uuid not null references public.profiles(id) on delete restrict,
  frozen_at timestamptz,
  frozen_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint draw_rosters_freeze_consistent check (
    (status = 'frozen' and frozen_at is not null and frozen_by is not null)
    or (status <> 'frozen' and frozen_at is null and frozen_by is null)
  )
);
create unique index draw_rosters_one_frozen_idx on public.draw_rosters(draw_id) where status = 'frozen';

create table public.draw_roster_entries (
  id uuid primary key default gen_random_uuid(),
  draw_roster_id uuid not null references public.draw_rosters(id) on delete restrict,
  bond_id uuid not null references public.bonds(id) on delete restrict,
  bond_number_id uuid not null references public.bond_numbers(id) on delete restrict,
  number_value integer not null check (number_value >= 0),
  buyer_snapshot jsonb not null check (jsonb_typeof(buyer_snapshot) = 'object'),
  collector_snapshot jsonb not null check (jsonb_typeof(collector_snapshot) = 'object'),
  eligible boolean not null,
  ineligibility_reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique (draw_roster_id, bond_number_id),
  unique (draw_roster_id, number_value),
  constraint draw_roster_entries_reason_consistent check (
    (eligible and ineligibility_reason is null)
    or (not eligible and ineligibility_reason is not null
      and ineligibility_reason = btrim(ineligibility_reason)
      and ineligibility_reason <> '' and char_length(ineligibility_reason) <= 1000)
  )
);

create index draws_campaign_idx on public.draws(campaign_id);
create index draws_created_by_idx on public.draws(created_by);
create index draws_annulled_by_idx on public.draws(annulled_by);
create index draw_rosters_draw_idx on public.draw_rosters(draw_id);
create index draw_rosters_generated_by_idx on public.draw_rosters(generated_by);
create index draw_rosters_frozen_by_idx on public.draw_rosters(frozen_by);
create index draw_rosters_created_by_idx on public.draw_rosters(created_by);
create index draw_roster_entries_bond_idx on public.draw_roster_entries(bond_id);
create index draw_roster_entries_number_idx on public.draw_roster_entries(bond_number_id);
create index draw_roster_entries_created_by_idx on public.draw_roster_entries(created_by);

create function public.draws_forbid_delete() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'draw history is never deleted or truncated' using errcode = '23001'; end; $$;

create function public.draws_guard_write() returns trigger
language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'scheduled' then
      raise exception 'draw must start scheduled' using errcode = '23514';
    end if;
  else
    if old.status in ('closed','annulled') then
      raise exception 'terminal draw is immutable' using errcode = '55000';
    end if;
    if (new.id,new.campaign_id,new.created_at,new.created_by) is distinct from
       (old.id,old.campaign_id,old.created_at,old.created_by) then
      raise exception 'draw identity is immutable' using errcode = '23001';
    end if;
    if new.status <> old.status and not (
      (old.status = 'scheduled' and new.status in ('roster_generated','annulled'))
      or (old.status = 'roster_generated' and new.status = 'roster_frozen')
      or (old.status = 'roster_frozen' and new.status = 'completed')
      or (old.status = 'completed' and new.status = 'closed')
    ) then raise exception 'invalid draw transition' using errcode = '23514'; end if;
    if old.status <> 'scheduled' and
       (new.draw_type,new.name,new.draw_date,new.payment_cutoff_at,new.required_installment_number,new.eligibility_rule)
       is distinct from
       (old.draw_type,old.name,old.draw_date,old.payment_cutoff_at,old.required_installment_number,old.eligibility_rule) then
      raise exception 'only scheduled draw rules can change' using errcode = '55000';
    end if;
  end if;
  if tg_op = 'INSERT' or new.required_installment_number is distinct from old.required_installment_number then
    -- Serialize rule admission with draft campaign count reductions. Status-only
    -- writes do not acquire a campaign lock after a draw lock.
    select installment_count into v_count from public.campaigns where id = new.campaign_id for share;
    if new.required_installment_number > v_count then
      raise exception 'required installment exceeds campaign count' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;

create function public.campaigns_guard_draw_installments() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.draws d where d.campaign_id = new.id
    and d.required_installment_number > new.installment_count) then
    raise exception 'campaign count cannot invalidate a draw installment' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger campaigns_guard_draw_installments before update of installment_count on public.campaigns
  for each row when (new.installment_count < old.installment_count)
  execute function public.campaigns_guard_draw_installments();

create function public.draw_rosters_guard_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'generated' then
      raise exception 'roster must start generated' using errcode = '23514';
    end if;
  else
    if old.status <> 'generated' then
      raise exception 'frozen or superseded roster is immutable' using errcode = '55000';
    end if;
    if (new.id,new.draw_id,new.generated_at,new.generated_by,new.created_at,new.created_by)
       is distinct from (old.id,old.draw_id,old.generated_at,old.generated_by,old.created_at,old.created_by) then
      raise exception 'roster identity is immutable' using errcode = '23001';
    end if;
    if new.status not in ('generated','frozen','superseded') then
      raise exception 'invalid roster transition' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;

-- Admission takes FOR SHARE on the parent roster: it conflicts with the non-key
-- UPDATE used by freezing. Future RPCs must lock draw -> roster -> entries, never
-- acquire a draw lock after a roster lock. No financial/ledger locks are involved.
create function public.draw_roster_entries_guard_write() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text; v_campaign uuid;
begin
  if tg_op = 'UPDATE' and (new.id,new.draw_roster_id,new.created_at,new.created_by)
    is distinct from (old.id,old.draw_roster_id,old.created_at,old.created_by) then
    raise exception 'entry identity is immutable' using errcode = '23001';
  end if;
  select r.status,d.campaign_id into v_status,v_campaign
    from public.draw_rosters r join public.draws d on d.id = r.draw_id
    where r.id = new.draw_roster_id for share of r;
  if v_status is not null and v_status <> 'generated' then
    raise exception 'entries require a generated roster' using errcode = '55000';
  end if;
  if v_campaign is not null and not exists (
    select 1 from public.bond_numbers n join public.bonds b on b.id = n.bond_id
    where n.id = new.bond_number_id and b.id = new.bond_id
      and n.campaign_id = v_campaign and b.campaign_id = v_campaign
      and n.number_value = new.number_value
  ) then raise exception 'entry number and bond must match the draw campaign' using errcode = '23514'; end if;
  new.updated_at := now();
  return new;
end; $$;

create trigger draws_guard_write before insert or update on public.draws
  for each row execute function public.draws_guard_write();
create trigger draw_rosters_guard_write before insert or update on public.draw_rosters
  for each row execute function public.draw_rosters_guard_write();
create trigger draw_roster_entries_guard_write before insert or update on public.draw_roster_entries
  for each row execute function public.draw_roster_entries_guard_write();

do $$ declare t text; begin
  foreach t in array array['draws','draw_rosters','draw_roster_entries'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function public.draws_forbid_delete()', t || '_forbid_delete', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.draws_forbid_delete()', t || '_forbid_truncate', t);
  end loop;
end $$;

revoke all on table public.draws,public.draw_rosters,public.draw_roster_entries from anon,authenticated,service_role;
grant select on table public.draws,public.draw_rosters,public.draw_roster_entries to authenticated;
alter table public.draws enable row level security;
alter table public.draw_rosters enable row level security;
alter table public.draw_roster_entries enable row level security;
create function public.draw_can_read() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission('draw.view') or public.has_permission('draw.create')
    or public.has_permission('draw.update') or public.has_permission('draw.generate_roster')
    or public.has_permission('draw.freeze_roster') or public.has_permission('draw.load_winner');
$$;
create policy draws_select on public.draws for select to authenticated using ((select public.draw_can_read()));
create policy draw_rosters_select on public.draw_rosters for select to authenticated using ((select public.draw_can_read()));
create policy draw_roster_entries_select on public.draw_roster_entries for select to authenticated using ((select public.draw_can_read()));
revoke all on function public.draws_forbid_delete(),public.draws_guard_write(),
  public.draw_rosters_guard_write(),public.draw_roster_entries_guard_write(),
  public.campaigns_guard_draw_installments() from public,anon,authenticated,service_role;
revoke all on function public.draw_can_read() from public,anon,service_role;
grant execute on function public.draw_can_read() to authenticated;
