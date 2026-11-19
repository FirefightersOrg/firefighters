-- SAN-53 / SAN-54: bond delivery to collectors, returns, reassignments and losses.
--
--   * bond_assignments: the custody history of each bond. A delivery or reassignment row is the
--     bond's custody while `active` (at most one active row per bond); it ends as `returned`,
--     `reassigned` or `lost`. Return and loss rows are events that record who did what and when.
--   * delivery_notes / delivery_note_items: the document handed to the collector, numbered
--     sequentially per campaign. A reassignment issues a note for the new collector too.
--   * Nothing is deleted (DELETE/TRUNCATE rejected for every role). Writes only through the
--     audited SECURITY DEFINER functions below; authenticated can only SELECT.
--
-- Transitions (docs/state-machines.md, enforced by bonds_guard_write):
--   deliver   available -> delivered_to_collector, current_collector_id set        (bond.assign)
--             only while the campaign is active (product decision on #47)
--   reassign  delivered_to_collector stays, current_collector_id changes            (bond.assign)
--   return    delivered_to_collector -> returned -> available, collector cleared    (bond.return)
--             one collector at a time, with a return note (reason 'return') as its receipt
--   lost      available | delivered_to_collector -> lost, collector cleared         (bond.mark_lost)
-- A sold bond is never returned, reassigned or marked lost here (55000).
--
-- Errors: 42501 permission / no active profile; 22023 bad input; P0002 collector or bond not found;
-- 55000 wrong bond status, inactive collector, campaign not active (deliver/reassign) or not
-- draft/active (return/loss), grouped member, bond no longer with the expected collector;
-- 23001 delete/truncate or change of immutable columns.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.delivery_notes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  note_number integer not null,
  collector_id uuid not null references public.collectors (id) on delete restrict,
  status text not null default 'issued',
  issued_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  notes text,
  -- delivery: a new handover; reassignment: bonds moved from another collector; return: bonds
  -- handed back by the collector (the collector's receipt).
  reason text not null default 'delivery',

  constraint delivery_notes_campaign_number_key unique (campaign_id, note_number),
  constraint delivery_notes_id_campaign_key unique (id, campaign_id),
  constraint delivery_notes_number_positive check (note_number >= 1),
  constraint delivery_notes_status_check check (status in ('issued', 'annulled')),
  constraint delivery_notes_reason_check check (reason in ('delivery', 'reassignment', 'return')),
  constraint delivery_notes_notes_valid
    check (btrim(notes) <> '' and notes = btrim(notes) and char_length(notes) <= 2000)
);

comment on table public.delivery_notes is
  'Bond delivery notes handed to collectors (SAN-53), numbered per campaign. Never deleted.';

create index delivery_notes_collector_idx on public.delivery_notes (campaign_id, collector_id, issued_at desc);
create index delivery_notes_created_by_idx on public.delivery_notes (created_by);

create table public.delivery_note_items (
  delivery_note_id uuid not null,
  bond_id uuid not null,
  campaign_id uuid not null,
  primary key (delivery_note_id, bond_id),
  -- Note and bond belong to the same campaign.
  constraint delivery_note_items_note_fkey foreign key (delivery_note_id, campaign_id)
    references public.delivery_notes (id, campaign_id) on delete restrict,
  constraint delivery_note_items_bond_fkey foreign key (bond_id, campaign_id)
    references public.bonds (id, campaign_id) on delete restrict
);

create index delivery_note_items_bond_idx on public.delivery_note_items (bond_id);

create table public.bond_assignments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  bond_id uuid not null,
  -- Null only for the loss of a bond that was never delivered.
  collector_id uuid references public.collectors (id) on delete restrict,
  assignment_type text not null,
  status text not null,
  assigned_at timestamptz not null default now(),
  returned_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete restrict,
  notes text,
  delivery_note_id uuid,
  -- Loss details (assignment_type = 'lost').
  responsible_party text,
  lost_on date,

  constraint bond_assignments_bond_fkey foreign key (bond_id, campaign_id)
    references public.bonds (id, campaign_id) on delete restrict,
  constraint bond_assignments_note_fkey foreign key (delivery_note_id, campaign_id)
    references public.delivery_notes (id, campaign_id) on delete restrict,
  constraint bond_assignments_type_check
    check (assignment_type in ('delivery', 'return', 'reassignment', 'lost')),
  constraint bond_assignments_status_check
    check (status in ('active', 'returned', 'reassigned', 'lost')),
  -- Custody rows (delivery/reassignment) have a collector and a note; events have their own status.
  constraint bond_assignments_shape check (
    case assignment_type
      when 'delivery' then collector_id is not null and delivery_note_id is not null
        and status in ('active', 'returned', 'reassigned', 'lost')
      when 'reassignment' then collector_id is not null and delivery_note_id is not null
        and status in ('active', 'returned', 'reassigned', 'lost')
      when 'return' then collector_id is not null and status = 'returned' and delivery_note_id is not null
      else status = 'lost' and delivery_note_id is null
        and responsible_party is not null and lost_on is not null and notes is not null
    end
  ),
  constraint bond_assignments_returned_at check ((returned_at is null) = (status = 'active')
    or assignment_type in ('return', 'lost')),
  constraint bond_assignments_responsible_valid check (
    btrim(responsible_party) <> '' and responsible_party = btrim(responsible_party)
    and char_length(responsible_party) <= 200),
  constraint bond_assignments_notes_valid
    check (btrim(notes) <> '' and notes = btrim(notes) and char_length(notes) <= 2000)
);

comment on table public.bond_assignments is
  'Custody history of bonds (SAN-53): deliveries/reassignments (active until returned, reassigned or lost) and return/loss events.';

create unique index bond_assignments_one_active_key on public.bond_assignments (bond_id)
  where status = 'active';
create index bond_assignments_bond_idx on public.bond_assignments (bond_id, assigned_at desc);
create index bond_assignments_collector_idx on public.bond_assignments (collector_id, status)
  where collector_id is not null;
create index bond_assignments_note_idx on public.bond_assignments (delivery_note_id)
  where delivery_note_id is not null;
create index bond_assignments_created_by_idx on public.bond_assignments (created_by);

-- ---------------------------------------------------------------------------
-- Guards: immutable history, no deletion
-- ---------------------------------------------------------------------------
create function public.delivery_forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are never deleted', tg_table_name using errcode = 'restrict_violation';
end;
$$;

-- delivery_notes and delivery_note_items are immutable once written (annulment is Phase 10).
create function public.delivery_forbid_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows cannot be changed', tg_table_name using errcode = 'restrict_violation';
end;
$$;

-- bond_assignments: only an active custody row may be closed (status + returned_at), once.
create function public.bond_assignments_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'active' then
    raise exception 'bond assignment % is closed and cannot be changed', old.id
      using errcode = 'restrict_violation';
  end if;
  if (new.id, new.campaign_id, new.bond_id, new.collector_id, new.assignment_type, new.assigned_at,
      new.created_by, new.notes, new.delivery_note_id, new.responsible_party, new.lost_on)
     is distinct from
     (old.id, old.campaign_id, old.bond_id, old.collector_id, old.assignment_type, old.assigned_at,
      old.created_by, old.notes, old.delivery_note_id, old.responsible_party, old.lost_on)
     or new.status not in ('returned', 'reassigned', 'lost') then
    raise exception 'only the status of an active bond assignment can be closed'
      using errcode = 'restrict_violation';
  end if;
  new.returned_at := now();
  return new;
end;
$$;

create trigger delivery_notes_forbid_update before update on public.delivery_notes
  for each row execute function public.delivery_forbid_update();
create trigger delivery_note_items_forbid_update before update on public.delivery_note_items
  for each row execute function public.delivery_forbid_update();
create trigger bond_assignments_guard_update before update on public.bond_assignments
  for each row execute function public.bond_assignments_guard_update();
create trigger delivery_notes_forbid_delete before delete on public.delivery_notes
  for each row execute function public.delivery_forbid_delete();
create trigger delivery_notes_forbid_truncate before truncate on public.delivery_notes
  for each statement execute function public.delivery_forbid_delete();
create trigger delivery_note_items_forbid_delete before delete on public.delivery_note_items
  for each row execute function public.delivery_forbid_delete();
create trigger delivery_note_items_forbid_truncate before truncate on public.delivery_note_items
  for each statement execute function public.delivery_forbid_delete();
create trigger bond_assignments_forbid_delete before delete on public.bond_assignments
  for each row execute function public.delivery_forbid_delete();
create trigger bond_assignments_forbid_truncate before truncate on public.bond_assignments
  for each statement execute function public.delivery_forbid_delete();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Locks the bonds of the call (in id order, to avoid deadlocks) and checks they exist, belong to
-- the campaign and are distinct. Returns them in id order.
create function public.delivery_lock_bonds(p_campaign_id uuid, p_bond_ids uuid[])
returns setof public.bonds
language plpgsql
set search_path = ''
as $$
declare
  v_count integer := coalesce(cardinality(p_bond_ids), 0);
begin
  if v_count = 0 then
    raise exception 'at least one bond is required' using errcode = 'invalid_parameter_value';
  end if;
  if v_count > 500 then
    raise exception 'at most 500 bonds can be handled at once (got %)', v_count
      using errcode = 'invalid_parameter_value';
  end if;
  if (select count(distinct b) from unnest(p_bond_ids) b) <> v_count or array_position(p_bond_ids, null) is not null then
    raise exception 'the bond list repeats a bond or has an empty entry' using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from public.bonds where id = any (p_bond_ids) order by id for update;
  if (select count(*) from public.bonds where id = any (p_bond_ids)) <> v_count then
    raise exception 'bond not found' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.bonds where id = any (p_bond_ids) and campaign_id <> p_campaign_id) then
    raise exception 'a bond belongs to another campaign' using errcode = 'invalid_parameter_value';
  end if;
  return query select * from public.bonds where id = any (p_bond_ids) order by id;
end;
$$;

-- An active collector of the campaign's organisation (collectors are global).
create function public.delivery_require_collector(p_collector_id uuid)
returns public.collectors
language plpgsql
set search_path = ''
as $$
declare
  v public.collectors;
begin
  select * into v from public.collectors where id = p_collector_id for share;
  if not found then
    raise exception 'collector % not found', p_collector_id using errcode = 'no_data_found';
  end if;
  if v.status <> 'active' then
    raise exception 'collector % is inactive and cannot receive bonds', v.display_name
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return v;
end;
$$;

-- Issues the next delivery note of the campaign (numbers serialised by an advisory lock).
create function public.delivery_issue_note(
  p_campaign_id uuid, p_collector_id uuid, p_actor uuid, p_notes text, p_reason text
)
returns public.delivery_notes
language plpgsql
set search_path = ''
as $$
declare
  v public.delivery_notes;
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('delivery_notes:' || p_campaign_id::text, 0));
  select coalesce(max(note_number), 0) + 1 into v_next
  from public.delivery_notes where campaign_id = p_campaign_id;
  insert into public.delivery_notes (campaign_id, note_number, collector_id, created_by, notes, reason)
  values (p_campaign_id, v_next, p_collector_id, p_actor, p_notes, p_reason)
  returning * into v;
  return v;
end;
$$;

create function public.delivery_text(p_value text, p_label text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(p_value), '');
begin
  if char_length(v) > p_max then
    raise exception '% must be at most % characters', p_label, p_max using errcode = 'invalid_parameter_value';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- bond_deliver: hand available bonds to a collector, with a delivery note.
-- ---------------------------------------------------------------------------
create function public.bond_deliver(
  p_campaign_id uuid,
  p_collector_id uuid,
  p_bond_ids uuid[],
  p_notes text default null,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.bond_require_actor('bond.assign');
  v_campaign public.campaigns;
  v_collector public.collectors;
  v_note public.delivery_notes;
  v_notes text := public.delivery_text(p_notes, 'notes', 2000);
  v_bond public.bonds;
begin
  v_campaign := public.bond_lock_campaign(p_campaign_id);
  if v_campaign.status <> 'active' then
    raise exception 'bonds are delivered to collectors only while the campaign is active'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  v_collector := public.delivery_require_collector(p_collector_id);
  for v_bond in select * from public.delivery_lock_bonds(p_campaign_id, p_bond_ids) loop
    if v_bond.commercial_status <> 'available' then
      raise exception 'bond % is % and cannot be delivered (only available bonds)',
        public.bond_label(v_bond.id, v_campaign.number_digits), v_bond.commercial_status
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end loop;

  v_note := public.delivery_issue_note(p_campaign_id, p_collector_id, v_actor, v_notes, 'delivery');
  for v_bond in select * from public.bonds where id = any (p_bond_ids) order by id loop
    -- A member of a manual pata is rejected here by bonds_guard_write (55000).
    update public.bonds set commercial_status = 'delivered_to_collector', current_collector_id = p_collector_id
    where id = v_bond.id;
    insert into public.delivery_note_items (delivery_note_id, bond_id, campaign_id)
    values (v_note.id, v_bond.id, p_campaign_id);
    insert into public.bond_assignments
      (campaign_id, bond_id, collector_id, assignment_type, status, created_by, delivery_note_id)
    values (p_campaign_id, v_bond.id, p_collector_id, 'delivery', 'active', v_actor, v_note.id);
    insert into public.audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, request_id)
    values (v_actor, 'bond.deliver', 'bond', v_bond.id::text,
      jsonb_build_object('commercial_status', 'available', 'current_collector_id', null),
      jsonb_build_object('commercial_status', 'delivered_to_collector', 'current_collector_id', p_collector_id,
        'delivery_note_id', v_note.id, 'note_number', v_note.note_number),
      p_request_id);
  end loop;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'delivery_note.issue', 'delivery_note', v_note.id::text,
    jsonb_build_object('campaign_id', p_campaign_id, 'note_number', v_note.note_number,
      'collector_id', p_collector_id, 'reason', 'delivery', 'bond_ids', to_jsonb(p_bond_ids)),
    p_request_id);
  return v_note.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- bond_reassign: move bonds delivered to one collector to another (with a note for the new one).
-- ---------------------------------------------------------------------------
create function public.bond_reassign(
  p_campaign_id uuid,
  p_collector_id uuid,
  p_bond_ids uuid[],
  p_notes text default null,
  p_request_id text default null,
  -- The collector the caller saw the bonds with (e.g. the collector record): when given, every
  -- bond must still be with that collector under the row lock, so a stale screen cannot move
  -- bonds that were reassigned meanwhile (55000).
  p_from_collector_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.bond_require_actor('bond.assign');
  v_campaign public.campaigns;
  v_note public.delivery_notes;
  v_notes text := public.delivery_text(p_notes, 'notes', 2000);
  v_bond public.bonds;
begin
  v_campaign := public.bond_lock_campaign(p_campaign_id);
  if v_campaign.status <> 'active' then
    raise exception 'bonds are delivered to collectors only while the campaign is active'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  perform public.delivery_require_collector(p_collector_id);
  for v_bond in select * from public.delivery_lock_bonds(p_campaign_id, p_bond_ids) loop
    if v_bond.commercial_status <> 'delivered_to_collector' then
      raise exception 'bond % is % and cannot be reassigned (only bonds delivered to a collector)',
        public.bond_label(v_bond.id, v_campaign.number_digits), v_bond.commercial_status
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    if p_from_collector_id is not null and v_bond.current_collector_id is distinct from p_from_collector_id then
      raise exception 'bond % is no longer with that collector; reload and try again',
        public.bond_label(v_bond.id, v_campaign.number_digits)
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    if v_bond.current_collector_id = p_collector_id then
      raise exception 'bond % is already delivered to that collector',
        public.bond_label(v_bond.id, v_campaign.number_digits)
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  v_note := public.delivery_issue_note(p_campaign_id, p_collector_id, v_actor, v_notes, 'reassignment');
  for v_bond in select * from public.bonds where id = any (p_bond_ids) order by id loop
    update public.bond_assignments set status = 'reassigned'
    where bond_id = v_bond.id and status = 'active';
    update public.bonds set current_collector_id = p_collector_id where id = v_bond.id;
    insert into public.delivery_note_items (delivery_note_id, bond_id, campaign_id)
    values (v_note.id, v_bond.id, p_campaign_id);
    insert into public.bond_assignments
      (campaign_id, bond_id, collector_id, assignment_type, status, created_by, delivery_note_id)
    values (p_campaign_id, v_bond.id, p_collector_id, 'reassignment', 'active', v_actor, v_note.id);
    insert into public.audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, request_id)
    values (v_actor, 'bond.reassign', 'bond', v_bond.id::text,
      jsonb_build_object('current_collector_id', v_bond.current_collector_id),
      jsonb_build_object('current_collector_id', p_collector_id, 'delivery_note_id', v_note.id,
        'note_number', v_note.note_number),
      p_request_id);
  end loop;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'delivery_note.issue', 'delivery_note', v_note.id::text,
    jsonb_build_object('campaign_id', p_campaign_id, 'note_number', v_note.note_number,
      'collector_id', p_collector_id, 'reason', 'reassignment', 'bond_ids', to_jsonb(p_bond_ids)),
    p_request_id);
  return v_note.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- bond_return: unsold bonds come back from their collector and are available again.
-- ---------------------------------------------------------------------------
create function public.bond_return(
  p_campaign_id uuid,
  p_bond_ids uuid[],
  p_notes text default null,
  p_request_id text default null,
  -- As in bond_reassign: when given, every bond must still be with this collector (55000).
  p_from_collector_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.bond_require_actor('bond.return');
  v_campaign public.campaigns;
  v_notes text := public.delivery_text(p_notes, 'notes', 2000);
  v_bond public.bonds;
  v_from uuid := p_from_collector_id;
  v_note public.delivery_notes;
begin
  v_campaign := public.bond_lock_campaign(p_campaign_id);
  for v_bond in select * from public.delivery_lock_bonds(p_campaign_id, p_bond_ids) loop
    if v_bond.commercial_status <> 'delivered_to_collector' then
      raise exception 'bond % is % and cannot be returned (only bonds delivered to a collector)',
        public.bond_label(v_bond.id, v_campaign.number_digits), v_bond.commercial_status
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    if p_from_collector_id is not null and v_bond.current_collector_id is distinct from p_from_collector_id then
      raise exception 'bond % is no longer with that collector; reload and try again',
        public.bond_label(v_bond.id, v_campaign.number_digits)
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    -- One return receipt per collector: every bond comes back from the same one.
    v_from := coalesce(v_from, v_bond.current_collector_id);
    if v_bond.current_collector_id is distinct from v_from then
      raise exception 'return the bonds of one collector at a time (bond % is with another collector)',
        public.bond_label(v_bond.id, v_campaign.number_digits)
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  -- The receipt handed to the collector, numbered with the campaign's delivery notes.
  v_note := public.delivery_issue_note(p_campaign_id, v_from, v_actor, v_notes, 'return');

  for v_bond in select * from public.bonds where id = any (p_bond_ids) order by id loop
    update public.bond_assignments set status = 'returned' where bond_id = v_bond.id and status = 'active';
    -- Through `returned`, as the state machine says, and back to stock.
    update public.bonds set commercial_status = 'returned' where id = v_bond.id;
    update public.bonds set commercial_status = 'available', current_collector_id = null where id = v_bond.id;
    insert into public.delivery_note_items (delivery_note_id, bond_id, campaign_id)
    values (v_note.id, v_bond.id, p_campaign_id);
    insert into public.bond_assignments
      (campaign_id, bond_id, collector_id, assignment_type, status, returned_at, created_by, notes,
       delivery_note_id)
    values (p_campaign_id, v_bond.id, v_bond.current_collector_id, 'return', 'returned', now(), v_actor,
      v_notes, v_note.id);
    insert into public.audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, request_id)
    values (v_actor, 'bond.return', 'bond', v_bond.id::text,
      jsonb_build_object('commercial_status', 'delivered_to_collector', 'current_collector_id', v_bond.current_collector_id),
      jsonb_build_object('commercial_status', 'available', 'current_collector_id', null,
        'delivery_note_id', v_note.id, 'note_number', v_note.note_number),
      p_request_id);
  end loop;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'delivery_note.issue', 'delivery_note', v_note.id::text,
    jsonb_build_object('campaign_id', p_campaign_id, 'note_number', v_note.note_number,
      'collector_id', v_from, 'reason', 'return', 'bond_ids', to_jsonb(p_bond_ids)),
    p_request_id);
  return v_note.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- bond_mark_lost: an available or delivered bond is lost (responsible party, date and reason).
-- ---------------------------------------------------------------------------
create function public.bond_mark_lost(
  p_campaign_id uuid,
  p_bond_id uuid,
  p_responsible_party text,
  p_lost_on date,
  p_reason text,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.bond_require_actor('bond.mark_lost');
  v_campaign public.campaigns;
  v_bond public.bonds;
  v_responsible text := public.delivery_text(p_responsible_party, 'responsible party', 200);
  v_reason text := public.delivery_text(p_reason, 'reason', 2000);
begin
  if v_responsible is null then
    raise exception 'the responsible party is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_lost_on is null then
    raise exception 'the date of the loss is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_lost_on > current_date then
    raise exception 'the date of the loss cannot be in the future' using errcode = 'invalid_parameter_value';
  end if;
  if v_reason is null then
    raise exception 'a reason is required' using errcode = 'invalid_parameter_value';
  end if;
  v_campaign := public.bond_lock_campaign(p_campaign_id);
  select * into v_bond from public.delivery_lock_bonds(p_campaign_id, array[p_bond_id]);
  if v_bond.commercial_status not in ('available', 'delivered_to_collector') then
    raise exception 'bond % is % and cannot be marked lost (only available or delivered bonds)',
      public.bond_label(v_bond.id, v_campaign.number_digits), v_bond.commercial_status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  update public.bond_assignments set status = 'lost' where bond_id = v_bond.id and status = 'active';
  update public.bonds set commercial_status = 'lost', current_collector_id = null where id = v_bond.id;
  insert into public.bond_assignments
    (campaign_id, bond_id, collector_id, assignment_type, status, returned_at, created_by, notes,
     responsible_party, lost_on)
  values (p_campaign_id, v_bond.id, v_bond.current_collector_id, 'lost', 'lost', now(), v_actor, v_reason,
    v_responsible, p_lost_on);
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (v_actor, 'bond.mark_lost', 'bond', v_bond.id::text,
    jsonb_build_object('commercial_status', v_bond.commercial_status, 'current_collector_id', v_bond.current_collector_id),
    jsonb_build_object('commercial_status', 'lost', 'responsible_party', v_responsible, 'lost_on', p_lost_on),
    v_reason, p_request_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
revoke all on table public.delivery_notes, public.delivery_note_items, public.bond_assignments
  from anon, authenticated, service_role;
grant select on table public.delivery_notes, public.delivery_note_items, public.bond_assignments
  to authenticated;
grant select, insert, update on table public.delivery_notes, public.delivery_note_items,
  public.bond_assignments to service_role;

alter table public.delivery_notes enable row level security;
alter table public.delivery_note_items enable row level security;
alter table public.bond_assignments enable row level security;

-- Readers of bonds see their custody history and notes; so do the delivery permissions. A
-- collector's own login sees what was handed to it ("own" scope).
create function public.delivery_can_read(p_collector_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('bond.view') or public.has_permission('bond.assign')
    or public.has_permission('bond.return') or public.has_permission('bond.mark_lost')
    or exists (select 1 from public.collectors c
               where c.id = p_collector_id and c.user_profile_id is not null
                 and c.user_profile_id = public.current_profile_id());
$$;

-- The permission part is wrapped in scalar subqueries so it is evaluated once per query
-- (initPlan); only the own-collector check runs per row.
create function public.delivery_is_own_collector(p_collector_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.collectors c
                 where c.id = p_collector_id and c.user_profile_id is not null
                   and c.user_profile_id = public.current_profile_id());
$$;

create policy delivery_notes_select on public.delivery_notes for select to authenticated
  using ((select public.delivery_can_read(null)) or public.delivery_is_own_collector(collector_id));
create policy delivery_note_items_select on public.delivery_note_items for select to authenticated
  using (exists (select 1 from public.delivery_notes n where n.id = delivery_note_id));
create policy bond_assignments_select on public.bond_assignments for select to authenticated
  using ((select public.delivery_can_read(null)) or public.delivery_is_own_collector(collector_id));

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.delivery_forbid_delete()', 'public.delivery_forbid_update()',
    'public.bond_assignments_guard_update()', 'public.delivery_lock_bonds(uuid, uuid[])',
    'public.delivery_require_collector(uuid)',
    'public.delivery_issue_note(uuid, uuid, uuid, text, text)',
    'public.delivery_text(text, text, integer)',
    'public.bond_deliver(uuid, uuid, uuid[], text, text)',
    'public.bond_reassign(uuid, uuid, uuid[], text, text, uuid)',
    'public.bond_return(uuid, uuid[], text, text, uuid)',
    'public.bond_mark_lost(uuid, uuid, text, date, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end;
$$;
-- The RLS helper runs for the reading user.
revoke all on function public.delivery_can_read(uuid) from public, anon, service_role;
grant execute on function public.delivery_can_read(uuid) to authenticated;
revoke all on function public.delivery_is_own_collector(uuid) from public, anon, service_role;
grant execute on function public.delivery_is_own_collector(uuid) to authenticated;

grant execute on function public.bond_deliver(uuid, uuid, uuid[], text, text) to authenticated;
grant execute on function public.bond_reassign(uuid, uuid, uuid[], text, text, uuid) to authenticated;
grant execute on function public.bond_return(uuid, uuid[], text, text, uuid) to authenticated;
grant execute on function public.bond_mark_lost(uuid, uuid, text, date, text, text) to authenticated;

comment on function public.bond_deliver(uuid, uuid, uuid[], text, text) is
  'Delivers available bonds to an active collector (bond.assign) with a new delivery note. Returns the note id.';
comment on function public.bond_reassign(uuid, uuid, uuid[], text, text, uuid) is
  'Moves delivered bonds to another active collector (bond.assign) with a new delivery note. Returns the note id.';
comment on function public.bond_return(uuid, uuid[], text, text, uuid) is
  'Returns delivered bonds to stock: delivered_to_collector -> returned -> available (bond.return). Returns the note id (one collector at a time, with a return note).';
comment on function public.bond_mark_lost(uuid, uuid, text, date, text, text) is
  'Marks an available or delivered bond lost with responsible party, date and reason (bond.mark_lost).';
