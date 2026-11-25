-- SAN-85: campaign dashboard (Phase 13). Two read-only functions for the next draw and the bonds
-- at risk of missing it. Everything else on the dashboard reuses the SAN-86/87 report functions.
--
-- Permission: `report.view_operational` + `campaign.view` (same helper as the operational
-- reports; operator, treasurer, read-only and admin). SECURITY DEFINER because the data comes from
-- sales, installments and payments, whose RLS needs permissions a read-only user does not hold.
-- No buyer data is returned: a bond number, its collector and the missing installments only.
--
-- Next draw: the earliest non-annulled, non-completed draw whose draw date is today or later
-- (Buenos Aires). At risk = a sold bond with an active sale whose required installments are not
-- fully covered by confirmed payments dated on or before the cutoff day (the same payment test as
-- draw_generate_roster, via draw_payment_before_cutoff). It is an estimate, not the roster: it does
-- not apply the roster's other exclusions (bonds that already won an excluding prize), it lists
-- nothing for a consolation draw without a required installment, and a sold bond without an
-- active payment plan is not listed. Monthly: installments 1..N. Consolation:
-- 1..N from draw_consolation_required. Final and extraordinary: every installment of the plan.
--
-- Errors: 42501 insufficient_privilege, P0002 no_data_found (campaign).

create function public.dashboard_at_risk_bonds_internal(p_draw_id uuid)
returns table (bond_id uuid, bond_kind text, missing_installments bigint, required_installments integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_draw public.draws%rowtype;
  v_required integer;
begin
  select * into v_draw from public.draws where id = p_draw_id;
  if not found then return; end if;
  v_required := case
    when v_draw.draw_type = 'monthly' then v_draw.required_installment_number
    when v_draw.draw_type = 'consolation'
      then public.draw_consolation_required(v_draw.required_installment_number, v_draw.eligibility_rule)
    else null end;
  if v_draw.draw_type in ('monthly', 'consolation') and v_required is null then return; end if;
  return query
  select b.id, b.kind, count(*) filter (where cov.applied < i.amount), v_required
  from public.bonds b
  join public.sales s on s.bond_id = b.id and s.status = 'active'
  join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active'
  join public.installments i on i.payment_plan_id = pp.id
    and (v_required is null or i.installment_number <= v_required)
  cross join lateral (
    select coalesce(sum(pi.amount_applied), 0) as applied
    from public.payment_installments pi
    join public.payments pay on pay.id = pi.payment_id
    where pi.installment_id = i.id
      and public.draw_payment_before_cutoff(pay.status, pay.payment_date, v_draw.payment_cutoff_at)
  ) cov
  where b.campaign_id = v_draw.campaign_id and b.commercial_status = 'sold' and b.annulled_at is null
  group by b.id, b.kind
  having count(*) filter (where cov.applied < i.amount) > 0;
end $$;

-- The next draw of the campaign (zero rows when none) with its number of bonds at risk.
create function public.dashboard_next_draw(p_campaign_id uuid)
returns table (
  draw_id uuid, draw_name text, draw_type text, draw_date date, payment_cutoff_at timestamptz,
  required_installment_number integer, draw_status text, at_risk_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  perform public.report_require_operational(p_campaign_id);
  return query
  select d.id, d.name, d.draw_type, d.draw_date, d.payment_cutoff_at, d.required_installment_number, d.status,
    (select count(*) from public.dashboard_at_risk_bonds_internal(d.id))
  from public.draws d
  where d.campaign_id = p_campaign_id and d.status in ('scheduled', 'roster_generated', 'roster_frozen')
    and d.draw_date >= v_today
  order by d.draw_date, d.payment_cutoff_at, d.created_at, d.id
  limit 1;
end $$;

-- Bonds at risk for one draw of the campaign, most installments missing first, then by number.
-- Paged with p_limit/p_offset; total_count is the full count of at-risk bonds.
create function public.dashboard_at_risk_bonds(
  p_campaign_id uuid,
  p_draw_id uuid,
  p_limit integer default 100,
  p_offset integer default 0
) returns table (
  bond_id uuid, bond_kind text, base_number integer, collector_id uuid, collector_name text,
  missing_installments bigint, required_installments integer, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.report_require_operational(p_campaign_id);
  if p_draw_id is null then
    raise exception 'draw is required' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.draws where id = p_draw_id and campaign_id = p_campaign_id) then
    raise exception 'draw % not found', p_draw_id using errcode = 'no_data_found';
  end if;
  return query
  select x.bond_id, x.bond_kind, num.base_number, b.current_collector_id, c.display_name,
    x.missing_installments, x.required_installments, count(*) over ()
  from public.dashboard_at_risk_bonds_internal(p_draw_id) x
  join public.bonds b on b.id = x.bond_id
  left join public.collectors c on c.id = b.current_collector_id
  left join lateral (
    select min(n.number_value) as base_number
    from public.bond_numbers n
    where n.number_kind = 'base' and n.released_at is null
      and (n.bond_id = x.bond_id or n.bond_id in (
        select g.member_bond_id from public.bond_groups g
        where g.pata_bond_id = x.bond_id and g.ungrouped_at is null))
  ) num on true
  order by x.missing_installments desc, num.base_number, x.bond_id
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end $$;

revoke all on function public.dashboard_at_risk_bonds_internal(uuid) from public, anon, authenticated, service_role;
revoke all on function public.dashboard_next_draw(uuid) from public, anon, service_role;
revoke all on function public.dashboard_at_risk_bonds(uuid, uuid, integer, integer) from public, anon, service_role;
grant execute on function public.dashboard_next_draw(uuid) to authenticated;
grant execute on function public.dashboard_at_risk_bonds(uuid, uuid, integer, integer) to authenticated;
