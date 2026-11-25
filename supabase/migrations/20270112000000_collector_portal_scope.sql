-- SAN-143: collector portal, own-scope foundation (Phase 16).
--
-- 1. Four dedicated own-scope permissions, granted to the `collector` role (admin gets every one):
--      bond.view_own              own bonds, numbers, groups, delivery notes and assignments
--      sale.view_own              own sales, plans, installments and payments, plus the narrow buyer read
--      collector.ledger.view_own  own current account, commission adjustments and settlements
--      payment.create_own         reserved for SAN-147 (register a collection); no RPC accepts it yet
--    They are NOT bond.view / sale.view / ...: those are global grants used all over policies and
--    functions. A `*_own` code only ever opens rows whose collector is the caller's own collector.
-- 2. One helper, `is_own_collector(uuid)`. The four per-domain copies stay as thin wrappers because
--    SECURITY DEFINER function bodies (settlement and ledger services) call them; they now hold no logic.
-- 3. Own-scope RLS on bonds, bond_numbers, bond_groups and commission_adjustments (new), and every
--    existing own-scope policy now also requires its `*_own` permission (permission AND ownership).
-- 4. `buyers_select` stays closed: the portal reads buyers through `portal_my_buyers`, a read-only
--    SECURITY DEFINER function with bounded columns. `portal_my_collector` resolves the caller's collector.
--
-- The link is collectors.user_profile_id; an unlinked profile, or a collector with no permission, sees nothing.
-- An inactive collector keeps read access to its own history (the helper never looked at status).

insert into public.permissions (code, description) values
  ('bond.view_own', 'View own bonds (collector portal).'),
  ('sale.view_own', 'View own sales, installments, payments and buyers (collector portal).'),
  ('collector.ledger.view_own', 'View own current account, commissions and settlements (collector portal).'),
  ('payment.create_own', 'Register own collections (collector portal, SAN-147).')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('bond.view_own', 'sale.view_own', 'collector.ledger.view_own', 'payment.create_own')
where r.name in ('admin', 'collector')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Single own-scope helper
-- ---------------------------------------------------------------------------
create function public.is_own_collector(p_collector_id uuid)
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
revoke all on function public.is_own_collector(uuid) from public, anon, service_role;
grant execute on function public.is_own_collector(uuid) to authenticated;

create or replace function public.delivery_is_own_collector(p_collector_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select public.is_own_collector(p_collector_id); $$;
create or replace function public.sale_is_own_collector(p_collector_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select public.is_own_collector(p_collector_id); $$;
create or replace function public.payment_settlement_is_own_collector(p_collector_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select public.is_own_collector(p_collector_id); $$;
create or replace function public.collector_ledger_is_own_collector(p_collector_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select public.is_own_collector(p_collector_id); $$;

-- ---------------------------------------------------------------------------
-- RLS: permission AND ownership. The permission lookups are scalar subqueries (initPlan).
-- ---------------------------------------------------------------------------
alter policy bonds_select on public.bonds
  using ((select public.has_permission('bond.view'))
    or ((select public.has_permission('bond.view_own')) and public.is_own_collector(current_collector_id)));

-- Numbers and groups follow the bond: a group is visible through its pata (members cannot be delivered alone).
alter policy bond_numbers_select on public.bond_numbers
  using ((select public.has_permission('bond.view'))
    or ((select public.has_permission('bond.view_own'))
        and exists (select 1 from public.bonds b where b.id = bond_id)));
alter policy bond_groups_select on public.bond_groups
  using ((select public.has_permission('bond.view'))
    or ((select public.has_permission('bond.view_own'))
        and exists (select 1 from public.bonds b where b.id = pata_bond_id)));

alter policy delivery_notes_select on public.delivery_notes
  using ((select public.delivery_can_read(null))
    or ((select public.has_permission('bond.view_own')) and public.is_own_collector(collector_id)));
alter policy bond_assignments_select on public.bond_assignments
  using ((select public.delivery_can_read(null))
    or ((select public.has_permission('bond.view_own')) and public.is_own_collector(collector_id)));

alter policy sales_select on public.sales
  using ((select public.sale_can_read())
    or ((select public.has_permission('sale.view_own')) and public.is_own_collector(collector_id)));
alter policy payments_select on public.payments
  using ((select public.payment_can_read())
    or ((select public.has_permission('sale.view_own')) and public.is_own_collector(collector_id)));

alter policy settlements_select on public.settlements
  using ((select public.settlement_can_read())
    or ((select public.has_permission('collector.ledger.view_own')) and public.is_own_collector(collector_id)));
alter policy collector_ledger_entries_select on public.collector_ledger_entries
  using ((select public.collector_ledger_can_read())
    or ((select public.has_permission('collector.ledger.view_own')) and public.is_own_collector(collector_id)));
alter policy commission_adjustments_select on public.commission_adjustments
  using ((select public.commission_adjustment_can_read())
    or ((select public.has_permission('collector.ledger.view_own')) and public.is_own_collector(collector_id)));

-- ---------------------------------------------------------------------------
-- Narrow read functions for the portal (read-only: nothing to audit)
-- ---------------------------------------------------------------------------
-- The caller's own collector (null row when the profile is not linked to a collector).
create function public.portal_my_collector()
returns table (id uuid, display_name text, status text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.display_name, c.status
  from public.collectors c
  where c.user_profile_id is not null and c.user_profile_id = public.current_profile_id();
$$;
revoke all on function public.portal_my_collector() from public, anon, service_role;
grant execute on function public.portal_my_collector() to authenticated;

-- Buyers of the caller's own sales in a campaign: name, phone and address only (no document, tax id or notes).
create function public.portal_my_buyers(p_campaign_id uuid)
returns table (buyer_id uuid, display_name text, phone text, address text, sale_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_permission('sale.view_own') and public.has_permission('campaign.view')) then
    raise exception 'permission denied: sale.view_own is required' using errcode = 'insufficient_privilege';
  end if;
  return query
  select b.id,
         coalesce(b.business_name, nullif(btrim(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, '')), '')),
         b.phone, b.address, count(*)
  from public.sales s
  join public.buyers b on b.id = s.buyer_id
  where s.campaign_id = p_campaign_id and s.status = 'active' and public.is_own_collector(s.collector_id)
  group by b.id, b.business_name, b.first_name, b.last_name, b.phone, b.address
  order by 2, b.id;
end $$;
revoke all on function public.portal_my_buyers(uuid) from public, anon, service_role;
grant execute on function public.portal_my_buyers(uuid) to authenticated;
