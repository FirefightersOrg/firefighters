-- SAN-80 storage only. SAN-81 supplies audited SECURITY DEFINER write RPCs.
create table public.prizes (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references public.draws(id) on delete restrict,
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 200),
  description text check (description = btrim(description) and description <> '' and char_length(description) <= 1000),
  position integer not null check (position > 0),
  status text not null default 'pending_validation' check (status in
    ('pending_validation','awarded','pending_delivery','delivered','unawarded','annulled')),
  excludes_from_consolation boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  annulled_at timestamptz,
  annulled_by uuid references public.profiles(id) on delete restrict,
  annul_reason text,
  unique(draw_id,position),
  constraint prizes_annulment_consistent check (
    (status = 'annulled' and annulled_at is not null and annulled_by is not null
      and annul_reason is not null and annul_reason = btrim(annul_reason)
      and annul_reason <> '' and char_length(annul_reason) <= 1000)
    or (status <> 'annulled' and annulled_at is null and annulled_by is null and annul_reason is null)
  )
);

create table public.winning_numbers (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references public.draws(id) on delete restrict,
  prize_id uuid not null unique references public.prizes(id) on delete restrict,
  number_value integer not null check (number_value >= 0),
  matched_roster_entry_id uuid references public.draw_roster_entries(id) on delete restrict,
  result_status text not null check (result_status in ('pending_review','eligible_winner','not_eligible','no_match')),
  loaded_by uuid not null references public.profiles(id) on delete restrict,
  loaded_at timestamptz not null default now(),
  notes text check (notes = btrim(notes) and notes <> '' and char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint winning_numbers_match_consistent check (
    (result_status = 'no_match') = (matched_roster_entry_id is null)
  )
);

create table public.prize_awards (
  id uuid primary key default gen_random_uuid(),
  prize_id uuid not null references public.prizes(id) on delete restrict,
  winning_number_id uuid not null references public.winning_numbers(id) on delete restrict,
  bond_id uuid not null references public.bonds(id) on delete restrict,
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  collector_id uuid not null references public.collectors(id) on delete restrict,
  status text not null default 'awarded' check (status in ('awarded','delivered','annulled')),
  awarded_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivered_by uuid references public.profiles(id) on delete restrict,
  notes text check (notes = btrim(notes) and notes <> '' and char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  annulled_at timestamptz,
  annulled_by uuid references public.profiles(id) on delete restrict,
  annul_reason text,
  constraint prize_awards_delivery_consistent check (
    (status = 'delivered' and delivered_at is not null and delivered_by is not null and notes is not null)
    or (status <> 'delivered' and delivered_at is null and delivered_by is null)
  ),
  constraint prize_awards_annulment_consistent check (
    (status = 'annulled' and annulled_at is not null and annulled_by is not null
      and annul_reason is not null and annul_reason = btrim(annul_reason)
      and annul_reason <> '' and char_length(annul_reason) <= 1000)
    or (status <> 'annulled' and annulled_at is null and annulled_by is null and annul_reason is null)
  )
);
create unique index prize_awards_one_active_idx on public.prize_awards(prize_id) where status <> 'annulled';
create index prizes_created_by_idx on public.prizes(created_by);
create index prizes_annulled_by_idx on public.prizes(annulled_by);
create index winning_numbers_draw_idx on public.winning_numbers(draw_id);
create index winning_numbers_entry_idx on public.winning_numbers(matched_roster_entry_id);
create index winning_numbers_loaded_by_idx on public.winning_numbers(loaded_by);
create index winning_numbers_created_by_idx on public.winning_numbers(created_by);
create index prize_awards_prize_idx on public.prize_awards(prize_id);
create index prize_awards_winning_number_idx on public.prize_awards(winning_number_id);
create index prize_awards_bond_idx on public.prize_awards(bond_id);
create index prize_awards_buyer_idx on public.prize_awards(buyer_id);
create index prize_awards_collector_idx on public.prize_awards(collector_id);
create index prize_awards_created_by_idx on public.prize_awards(created_by);
create index prize_awards_delivered_by_idx on public.prize_awards(delivered_by);
create index prize_awards_annulled_by_idx on public.prize_awards(annulled_by);

create function public.prizes_guard_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending_validation' then
      raise exception 'prize must start pending validation' using errcode = '23514';
    end if;
  else
    if old.status in ('delivered','unawarded','annulled') then
      raise exception 'terminal prize is immutable' using errcode = '55000';
    end if;
    if (new.id,new.draw_id,new.created_at,new.created_by) is distinct from
       (old.id,old.draw_id,old.created_at,old.created_by) then
      raise exception 'prize identity is immutable' using errcode = '23001';
    end if;
    if old.status <> 'pending_validation' and
      (new.name,new.description,new.position,new.excludes_from_consolation) is distinct from
      (old.name,old.description,old.position,old.excludes_from_consolation) then
      raise exception 'resolved prize configuration is immutable' using errcode = '55000';
    end if;
    if new.status <> old.status and not (
      (old.status = 'pending_validation' and new.status in ('awarded','unawarded'))
      or (old.status = 'awarded' and new.status in ('pending_delivery','annulled'))
      or (old.status = 'pending_delivery' and new.status = 'delivered')
    ) then raise exception 'invalid prize transition' using errcode = '23514'; end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;

-- Admission order: campaign FOR SHARE -> draw FOR SHARE -> prize -> winner -> award.
-- Future RPCs MUST prelock parents in that order before updating a child row:
-- row triggers run after the child's UPDATE lock has already been acquired.
-- Frozen entries/rosters and resolved winners are immutable; no ledger locks.
create function public.winning_numbers_guard_write() returns trigger
language plpgsql set search_path = '' as $$
declare v_campaign uuid; v_max integer; v_status text; v_entry uuid;
  v_eligible boolean;
begin
  if tg_op = 'UPDATE' then
    if old.result_status <> 'pending_review' then
      raise exception 'resolved winning number is immutable' using errcode = '55000';
    end if;
    if (new.id,new.draw_id,new.prize_id,new.number_value,new.matched_roster_entry_id,
        new.loaded_by,new.loaded_at,new.created_by,new.created_at) is distinct from
       (old.id,old.draw_id,old.prize_id,old.number_value,old.matched_roster_entry_id,
        old.loaded_by,old.loaded_at,old.created_by,old.created_at) then
      raise exception 'winning number identity is immutable' using errcode = '23001';
    end if;
  end if;
  select campaign_id into v_campaign from public.draws where id = new.draw_id;
  select max_number into v_max from public.campaigns where id = v_campaign for share;
  select status into v_status from public.draws where id = new.draw_id for share;
  if v_status is not null and v_status not in ('roster_frozen','completed') then
    raise exception 'winning numbers require a frozen draw' using errcode = '55000';
  end if;
  if new.number_value > v_max then
    raise exception 'winning number exceeds campaign maximum' using errcode = '23514';
  end if;
  if exists(select 1 from public.prizes where id = new.prize_id and draw_id <> new.draw_id) then
    raise exception 'prize must belong to draw' using errcode = '23514';
  end if;
  select e.id,e.eligible into v_entry,v_eligible
    from public.draw_roster_entries e join public.draw_rosters r on r.id = e.draw_roster_id
    where r.draw_id = new.draw_id and r.status = 'frozen' and e.number_value = new.number_value;
  if not exists(select 1 from public.draw_rosters where draw_id = new.draw_id and status = 'frozen') then
    raise exception 'draw must have a frozen roster' using errcode = '55000';
  end if;
  if new.matched_roster_entry_id is distinct from v_entry then
    raise exception 'match must be the frozen roster entry for the winning value' using errcode = '23514';
  end if;
  if (new.result_status = 'eligible_winner' and v_eligible is distinct from true)
    or (new.result_status = 'not_eligible' and v_eligible is distinct from false) then
    raise exception 'result must match frozen eligibility' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end; $$;

create function public.campaigns_guard_winning_numbers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.winning_numbers w join public.draws d on d.id = w.draw_id
    where d.campaign_id = new.id and w.number_value > new.max_number) then
    raise exception 'campaign maximum cannot invalidate winning numbers' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger campaigns_guard_winning_numbers before update of max_number on public.campaigns
  for each row when (new.max_number < old.max_number)
  execute function public.campaigns_guard_winning_numbers();

create function public.prize_awards_guard_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'awarded' then
      raise exception 'award must start awarded' using errcode = '23514';
    end if;
  else
    if old.status <> 'awarded' then
      raise exception 'terminal award is immutable' using errcode = '55000';
    end if;
    if (new.id,new.prize_id,new.winning_number_id,new.bond_id,new.buyer_id,new.collector_id,
        new.awarded_at,new.created_at,new.created_by) is distinct from
       (old.id,old.prize_id,old.winning_number_id,old.bond_id,old.buyer_id,old.collector_id,
        old.awarded_at,old.created_at,old.created_by) then
      raise exception 'award identity is immutable' using errcode = '23001';
    end if;
  end if;
  if not exists (
    select 1 from public.winning_numbers w join public.draw_roster_entries e on e.id = w.matched_roster_entry_id
    where w.id = new.winning_number_id and w.prize_id = new.prize_id
      and w.result_status = 'eligible_winner' and e.eligible
      and e.bond_id = new.bond_id and e.buyer_snapshot->>'id' = new.buyer_id::text
      and e.collector_snapshot->>'id' = new.collector_id::text
  ) then raise exception 'award must match eligible winner and frozen parties' using errcode = '23514'; end if;
  new.updated_at := now();
  return new;
end; $$;

create trigger prizes_guard_write before insert or update on public.prizes
  for each row execute function public.prizes_guard_write();
create trigger winning_numbers_guard_write before insert or update on public.winning_numbers
  for each row execute function public.winning_numbers_guard_write();
create trigger prize_awards_guard_write before insert or update on public.prize_awards
  for each row execute function public.prize_awards_guard_write();
do $$ declare t text; begin
  foreach t in array array['prizes','winning_numbers','prize_awards'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function public.draws_forbid_delete()', t || '_forbid_delete', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.draws_forbid_delete()', t || '_forbid_truncate', t);
  end loop;
end $$;

revoke all on table public.prizes,public.winning_numbers,public.prize_awards from anon,authenticated,service_role;
grant select on table public.prizes,public.winning_numbers,public.prize_awards to authenticated;
alter table public.prizes enable row level security;
alter table public.winning_numbers enable row level security;
alter table public.prize_awards enable row level security;
create function public.prize_can_read() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission('draw.view') or public.has_permission('draw.load_winner')
    or public.has_permission('prize.resolve') or public.has_permission('prize.deliver');
$$;
create policy prizes_select on public.prizes for select to authenticated using ((select public.prize_can_read()));
create policy winning_numbers_select on public.winning_numbers for select to authenticated using ((select public.prize_can_read()));
create policy prize_awards_select on public.prize_awards for select to authenticated using ((select public.prize_can_read()));
revoke all on function public.prizes_guard_write(),public.winning_numbers_guard_write(),
  public.prize_awards_guard_write(),public.campaigns_guard_winning_numbers() from public,anon,authenticated,service_role;
revoke all on function public.prize_can_read() from public,anon,service_role;
grant execute on function public.prize_can_read() to authenticated;
