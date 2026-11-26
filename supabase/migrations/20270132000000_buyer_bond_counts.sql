-- SAN-169: bonds of a campaign per buyer, grouped in one query.
--
-- The buyers list (/campaigns/[id]/buyers) says how many bonds of the campaign each buyer on the
-- page has. It used to read the bonds of every buyer one by one (an N+1). This returns the counts
-- of all the page's buyers at once. Same rows as reading `public.bonds` with
-- `current_buyer_id = <buyer>` and `campaign_id = <campaign>`: annulled bonds included.
--
-- SECURITY INVOKER: it runs with the caller's privileges, so the RLS of `bonds` (bond.view)
-- applies exactly as for a direct read: a role without bond.view gets no rows. Buyers without
-- bonds do not appear (the caller treats a missing buyer as 0). Read only.

create function public.buyer_bond_counts(p_campaign_id uuid, p_buyer_ids uuid[])
returns table (buyer_id uuid, bond_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.current_buyer_id, count(*)::integer
  from public.bonds b
  where b.campaign_id = p_campaign_id
    and b.current_buyer_id = any(p_buyer_ids)
  group by b.current_buyer_id
$$;

comment on function public.buyer_bond_counts(uuid, uuid[]) is
  'SAN-169: bonds of the campaign per buyer (annulled included), one grouped query. '
  'security invoker: bond.view RLS applies.';

revoke all on function public.buyer_bond_counts(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.buyer_bond_counts(uuid, uuid[]) to authenticated;
