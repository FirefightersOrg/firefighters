-- A manual pata may be annulled only after its active memberships are removed.
-- The original guard correctly rejects direct annulment with members, but must also allow the
-- zero-member transition performed atomically by bond_ungroup_pata.
create or replace function public.bonds_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_members integer;
begin
  if tg_op = 'INSERT' then
    if new.commercial_status not in ('created', 'available') then
      raise exception 'new bonds must start in created or available status (got %)', new.commercial_status using errcode = 'check_violation';
    end if;
    if new.financial_status_snapshot is distinct from 'no_payments' then
      raise exception 'new bonds must start with financial status no_payments (got %)', new.financial_status_snapshot using errcode = 'check_violation';
    end if;
    select * into v_campaign from public.campaigns where id = new.campaign_id for share;
    if found then
      if v_campaign.status not in ('draft', 'active') then
        raise exception 'bonds can only be created while the campaign is draft or active (status: %)', v_campaign.status using errcode = 'object_not_in_prerequisite_state';
      end if;
      if new.total_value is distinct from v_campaign.simple_bond_value * new.commercial_unit_count then
        raise exception 'bond total value must be % (simple bond value % x % units), got %', v_campaign.simple_bond_value * new.commercial_unit_count, v_campaign.simple_bond_value, new.commercial_unit_count, new.total_value using errcode = 'check_violation';
      end if;
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id or new.campaign_id is distinct from old.campaign_id
    or new.kind is distinct from old.kind or new.origin is distinct from old.origin
    or new.commercial_unit_count is distinct from old.commercial_unit_count
    or new.total_value is distinct from old.total_value or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by then
    raise exception 'bonds.id, campaign_id, kind, origin, commercial_unit_count, total_value, created_at and created_by cannot be changed' using errcode = 'restrict_violation';
  end if;

  if (new.internal_code, new.barcode, new.commercial_status, new.current_collector_id,
      new.current_buyer_id, new.annulled_at, new.annulled_by, new.annul_reason)
    is distinct from (old.internal_code, old.barcode, old.commercial_status, old.current_collector_id,
      old.current_buyer_id, old.annulled_at, old.annulled_by, old.annul_reason) then
    if old.commercial_status in ('annulled', 'closed') then
      raise exception 'bond % is % and cannot be changed', old.id, old.commercial_status using errcode = 'object_not_in_prerequisite_state';
    end if;
    if exists (select 1 from public.bond_groups g where g.member_bond_id = old.id and g.ungrouped_at is null) then
      raise exception 'bond % belongs to a manually grouped pata and cannot be changed individually', old.id using errcode = 'object_not_in_prerequisite_state', hint = 'ungroup the pata first';
    end if;
  end if;

  if new.commercial_status is distinct from old.commercial_status
    and (old.commercial_status, new.commercial_status) not in (
      ('created', 'available'), ('available', 'delivered_to_collector'), ('delivered_to_collector', 'sold'),
      ('delivered_to_collector', 'returned'), ('returned', 'available'), ('available', 'lost'),
      ('delivered_to_collector', 'lost'), ('available', 'annulled'), ('sold', 'annulled'), ('sold', 'closed')
    ) then
    raise exception 'invalid bond status transition: % -> %', old.commercial_status, new.commercial_status using errcode = 'check_violation';
  end if;

  if old.origin = 'manual_grouping' and old.commercial_status = 'available'
    and new.commercial_status <> 'available' then
    select count(*) into v_members from public.bond_groups g
    where g.pata_bond_id = old.id and g.ungrouped_at is null;
    if new.commercial_status = 'annulled' then
      if v_members <> 0 then
        raise exception 'manually grouped pata % has % active members and must be ungrouped before annulment', old.id, v_members using errcode = 'object_not_in_prerequisite_state';
      end if;
    elsif v_members <> old.commercial_unit_count then
      raise exception 'manually grouped pata % has % of % members and cannot leave available', old.id, v_members, old.commercial_unit_count using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;

  if new.commercial_status = 'annulled' and old.commercial_status <> 'annulled' then
    new.annulled_at := now();
    new.annulled_from_status := old.commercial_status;
  elsif new.annulled_from_status is distinct from old.annulled_from_status then
    raise exception 'bonds.annulled_from_status is set by the database when the bond is annulled and cannot be changed' using errcode = 'restrict_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.bonds_guard_write() from public, anon, authenticated, service_role;
