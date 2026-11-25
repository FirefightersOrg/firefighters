-- SAN-86: operational reports (Phase 13). Read-only aggregates, one function per report.
--
-- Roles: `report.view_operational` is granted to operator ("operations"), treasurer and read-only
-- ("auditor"); admin already holds every permission. There is no collector-coordinator role in
-- the catalog, so no per-coordinator scoping exists yet (docs/permissions.md).
--
-- Why SECURITY DEFINER: the reports aggregate bonds, sales, installments and payments, and the
-- RLS of those tables needs the matching view permission of each (a read-only user holds none of
-- sale.view / payment.view). The report permission is the access rule instead: every function
-- checks `report.view_operational` and `campaign.view` itself and returns aggregates only (no
-- buyer data). Amounts come back as text so cents are never rounded by JSON.
--
-- Errors: 42501 insufficient_privilege (missing permission), P0002 no_data_found (campaign).

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'report.view_operational'
where r.name in ('operator', 'treasurer', 'read-only')
on conflict do nothing;

create function public.report_require_operational(p_campaign_id uuid)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_permission('report.view_operational') and public.has_permission('campaign.view')) then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.campaigns where id = p_campaign_id) then
    raise exception 'campaign % not found', p_campaign_id using errcode = 'no_data_found';
  end if;
end $$;

-- Bonds by commercial and financial status (financial status = the bond snapshot).
create function public.report_bonds_by_status(
  p_campaign_id uuid,
  p_collector_id uuid default null,
  p_kind text default null,
  p_commercial_status text default null,
  p_financial_status text default null
) returns table (commercial_status text, financial_status text, bond_count bigint, total_value text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.report_require_operational(p_campaign_id);
  return query
  select b.commercial_status, b.financial_status_snapshot, count(*), coalesce(sum(b.total_value), 0)::numeric(14,2)::text
  from public.bonds b
  where b.campaign_id = p_campaign_id
    and (p_collector_id is null or b.current_collector_id = p_collector_id)
    and (p_kind is null or b.kind = p_kind)
    and (p_commercial_status is null or b.commercial_status = p_commercial_status)
    and (p_financial_status is null or b.financial_status_snapshot = p_financial_status)
  group by b.commercial_status, b.financial_status_snapshot
  order by b.commercial_status, b.financial_status_snapshot;
end $$;

-- Bonds by collector (current collector; a null collector is "unassigned").
create function public.report_bonds_by_collector(
  p_campaign_id uuid,
  p_collector_id uuid default null,
  p_kind text default null,
  p_commercial_status text default null,
  p_financial_status text default null
) returns table (
  collector_id uuid, collector_name text, bond_count bigint, delivered_count bigint,
  sold_count bigint, returned_count bigint, total_value text, sold_value text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.report_require_operational(p_campaign_id);
  return query
  select b.current_collector_id, c.display_name, count(*),
    count(*) filter (where b.commercial_status = 'delivered_to_collector'),
    count(*) filter (where b.commercial_status in ('sold', 'closed')),
    count(*) filter (where b.commercial_status = 'returned'),
    coalesce(sum(b.total_value), 0)::numeric(14,2)::text,
    coalesce(sum(b.total_value) filter (where b.commercial_status in ('sold', 'closed')), 0)::numeric(14,2)::text
  from public.bonds b
  left join public.collectors c on c.id = b.current_collector_id
  where b.campaign_id = p_campaign_id
    and (p_collector_id is null or b.current_collector_id = p_collector_id)
    and (p_kind is null or b.kind = p_kind)
    and (p_commercial_status is null or b.commercial_status = p_commercial_status)
    and (p_financial_status is null or b.financial_status_snapshot = p_financial_status)
  group by b.current_collector_id, c.display_name
  order by c.display_name nulls last, b.current_collector_id;
end $$;

-- Installments of active sales by bucket: paid, advance (paid before the due date), overdue
-- (status overdue, or pending past its due date in Buenos Aires) and pending. p_from/p_to filter
-- the due date, inclusive.
create function public.report_installments(
  p_campaign_id uuid,
  p_collector_id uuid default null,
  p_kind text default null,
  p_from date default null,
  p_to date default null
) returns table (
  collector_id uuid, collector_name text, bucket text, installment_count bigint, amount text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  perform public.report_require_operational(p_campaign_id);
  return query
  select s.collector_id, c.display_name, x.bucket, count(*), coalesce(sum(i.amount), 0)::numeric(14,2)::text
  from public.installments i
  join public.payment_plans pp on pp.id = i.payment_plan_id and pp.status = 'active'
  join public.sales s on s.id = pp.sale_id and s.status = 'active' and s.campaign_id = p_campaign_id
  join public.bonds b on b.id = s.bond_id
  join public.collectors c on c.id = s.collector_id
  cross join lateral (
    select case
      when i.status = 'paid' then 'paid'
      when i.status = 'paid_advance' then 'advance'
      when i.status = 'overdue' or (i.status = 'pending' and i.due_date < v_today) then 'overdue'
      else 'pending'
    end as bucket
  ) x
  where i.status <> 'annulled'
    and (p_collector_id is null or s.collector_id = p_collector_id)
    and (p_kind is null or b.kind = p_kind)
    and (p_from is null or i.due_date >= p_from)
    and (p_to is null or i.due_date <= p_to)
  group by s.collector_id, c.display_name, x.bucket
  order by c.display_name, s.collector_id, x.bucket;
end $$;

-- Monthly operational summary per collector. p_month is any date of the month (Buenos Aires).
-- Assigned = bonds the collector holds today (delivered, not yet sold); sold = active sales
-- registered in the month; installments = due in the month, unpaid ones split into pending and
-- overdue; payments = payment_date in the month, excluding drafts and annulled payments.
create function public.report_collector_monthly(
  p_campaign_id uuid,
  p_month date,
  p_collector_id uuid default null
) returns table (
  collector_id uuid, collector_name text, assigned_bonds bigint, sold_bonds bigint,
  sold_value text, pending_installments bigint, pending_amount text, overdue_installments bigint,
  overdue_amount text, payments_count bigint, payments_total text, payments_cash text,
  payments_transfer text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_from date;
  v_to date;
begin
  perform public.report_require_operational(p_campaign_id);
  if p_month is null then
    raise exception 'month is required' using errcode = 'invalid_parameter_value';
  end if;
  v_from := date_trunc('month', p_month)::date;
  v_to := (v_from + interval '1 month - 1 day')::date;
  return query
  with assigned as (
    select b.current_collector_id as cid, count(*) as n
    from public.bonds b
    where b.campaign_id = p_campaign_id and b.commercial_status = 'delivered_to_collector'
      and b.current_collector_id is not null
    group by 1
  ), sold as (
    select s.collector_id as cid, count(*) as n, coalesce(sum(s.total_amount), 0) as total
    from public.sales s
    where s.campaign_id = p_campaign_id and s.status = 'active'
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date between v_from and v_to
    group by 1
  ), inst as (
    select s.collector_id as cid,
      count(*) filter (where not (i.status = 'overdue' or i.due_date < v_today)) as pending_n,
      coalesce(sum(i.amount) filter (where not (i.status = 'overdue' or i.due_date < v_today)), 0) as pending_total,
      count(*) filter (where i.status = 'overdue' or i.due_date < v_today) as overdue_n,
      coalesce(sum(i.amount) filter (where i.status = 'overdue' or i.due_date < v_today), 0) as overdue_total
    from public.installments i
    join public.payment_plans pp on pp.id = i.payment_plan_id and pp.status = 'active'
    join public.sales s on s.id = pp.sale_id and s.status = 'active' and s.campaign_id = p_campaign_id
    where i.status in ('pending', 'overdue') and i.due_date between v_from and v_to
    group by 1
  ), pay as (
    select p.collector_id as cid, count(*) as n, coalesce(sum(p.amount), 0) as total,
      coalesce(sum(p.amount) filter (where p.payment_method = 'cash'), 0) as cash,
      coalesce(sum(p.amount) filter (where p.payment_method = 'transfer'), 0) as transfer
    from public.payments p
    where p.campaign_id = p_campaign_id and p.status not in ('draft', 'annulled')
      and p.payment_date between v_from and v_to
    group by 1
  ), ids as (
    select cid from assigned union select cid from sold union select cid from inst union select cid from pay
  )
  select ids.cid, c.display_name,
    coalesce(a.n, 0), coalesce(so.n, 0), coalesce(so.total, 0)::numeric(14,2)::text,
    coalesce(i.pending_n, 0), coalesce(i.pending_total, 0)::numeric(14,2)::text,
    coalesce(i.overdue_n, 0), coalesce(i.overdue_total, 0)::numeric(14,2)::text,
    coalesce(pa.n, 0), coalesce(pa.total, 0)::numeric(14,2)::text, coalesce(pa.cash, 0)::numeric(14,2)::text, coalesce(pa.transfer, 0)::numeric(14,2)::text
  from ids
  join public.collectors c on c.id = ids.cid
  left join assigned a on a.cid = ids.cid
  left join sold so on so.cid = ids.cid
  left join inst i on i.cid = ids.cid
  left join pay pa on pa.cid = ids.cid
  where p_collector_id is null or ids.cid = p_collector_id
  order by c.display_name, ids.cid;
end $$;

revoke all on function public.report_require_operational(uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_bonds_by_status(uuid, uuid, text, text, text) from public, anon, service_role;
revoke all on function public.report_bonds_by_collector(uuid, uuid, text, text, text) from public, anon, service_role;
revoke all on function public.report_installments(uuid, uuid, text, date, date) from public, anon, service_role;
revoke all on function public.report_collector_monthly(uuid, date, uuid) from public, anon, service_role;
grant execute on function public.report_bonds_by_status(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.report_bonds_by_collector(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.report_installments(uuid, uuid, text, date, date) to authenticated;
grant execute on function public.report_collector_monthly(uuid, date, uuid) to authenticated;
