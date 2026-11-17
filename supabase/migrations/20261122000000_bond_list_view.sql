-- SAN-26: public.bond_list, the read model of the bonds list (/campaigns/[id]/bonds).
--
-- One row per bond with its participating numbers as sorted integer arrays, so PostgREST can
-- filter by number (`base_numbers=cs.{68}`), order by the lowest base number and count, in one
-- query per page:
--   * simple bond / printed pata: its own numbers;
--   * manually grouped pata: the numbers of its members (it owns none). Every membership counts,
--     so an ungrouped (annulled) pata is still found by the numbers it had;
--   * released numbers (annulled bonds) are included: an annulled bond is still found by them.
-- group_pata_id is the manual pata a simple bond is an active member of ("in pata X").
--
-- security_invoker: reads run with the caller's privileges, so the RLS of bonds, bond_numbers
-- and bond_groups (bond.view) applies exactly as when the tables are read directly. Read only.

create view public.bond_list
with (security_invoker = true)
as
select
  b.id,
  b.campaign_id,
  b.kind,
  b.origin,
  b.internal_code,
  b.barcode,
  b.commercial_status,
  b.financial_status_snapshot,
  b.current_collector_id,
  b.current_buyer_id,
  b.commercial_unit_count,
  b.total_value,
  b.created_at,
  nums.base_numbers,
  nums.associated_numbers,
  -- Sort key: the lowest participating base number (null only for a bond without numbers).
  nums.base_numbers[1] as sort_number,
  grp.pata_bond_id as group_pata_id
from public.bonds b
cross join lateral (
  select
    coalesce(
      array_agg(n.number_value order by n.number_value) filter (where n.number_kind = 'base'),
      '{}'::integer[]
    ) as base_numbers,
    coalesce(
      array_agg(n.number_value order by n.number_value) filter (where n.number_kind = 'associated'),
      '{}'::integer[]
    ) as associated_numbers
  from (
    select own.number_value, own.number_kind
    from public.bond_numbers own
    where own.bond_id = b.id
    union all
    select member.number_value, member.number_kind
    from public.bond_groups g
    join public.bond_numbers member on member.bond_id = g.member_bond_id
    where b.origin = 'manual_grouping' and g.pata_bond_id = b.id
  ) n
) nums
left join lateral (
  select g.pata_bond_id
  from public.bond_groups g
  where g.member_bond_id = b.id and g.ungrouped_at is null
  limit 1
) grp on true;

comment on view public.bond_list is
  'SAN-26: bonds with their participating numbers (manual patas: their members'') for the bonds '
  'list. security_invoker: bond.view RLS applies.';
comment on column public.bond_list.base_numbers is
  'Participating base numbers, sorted (released ones included; a manual pata: its members'').';
comment on column public.bond_list.group_pata_id is
  'The manual pata this bond is an active member of, if any.';

-- Supabase grants ALL to anon, authenticated and service_role by default: read only, no anon.
revoke all on table public.bond_list from anon, authenticated, service_role;
grant select on table public.bond_list to authenticated, service_role;
