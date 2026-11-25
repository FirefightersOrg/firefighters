-- SAN-87: financial and draw reports (Phase 13) and the `report.export` grants.
--
-- Roles: `report.view_financial` is already granted to treasurer and read-only ("auditor"), and
-- admin holds every permission. `report.export` was admin-only (SAN-90 backups); it now also goes
-- to operator ("operations"), treasurer and read-only. The export endpoints still require the
-- view permission of the report (operational or financial), so an operator can export only the
-- operational reports.
--
-- Why SECURITY DEFINER: the reports aggregate payments, settlements, the collector ledger, draw
-- rosters and prizes, whose RLS needs the matching view permission of each (a read-only user holds
-- none of payment.view, settlement.view or collector.ledger.view). The report permission is the
-- access rule instead: every function checks `report.view_financial` and `campaign.view` itself.
-- Amounts come back as text so cents are never rounded by JSON. Dates are Buenos Aires dates.
--
-- Errors: 42501 insufficient_privilege (missing permission), P0002 no_data_found (campaign or
-- draw not in the campaign), 22023 invalid_parameter_value (missing/invalid argument).

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'report.export'
where r.name in ('operator', 'treasurer', 'read-only')
on conflict do nothing;

create function public.report_require_financial(p_campaign_id uuid)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_permission('report.view_financial') and public.has_permission('campaign.view')) then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.campaigns where id = p_campaign_id) then
    raise exception 'campaign % not found', p_campaign_id using errcode = 'no_data_found';
  end if;
end $$;

-- Payments by payment date and method. Drafts and annulled payments do not count.
create function public.report_payments_by_date(
  p_campaign_id uuid,
  p_collector_id uuid default null,
  p_method text default null,
  p_from date default null,
  p_to date default null
) returns table (payment_date date, payment_method text, payment_count bigint, total text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.report_require_financial(p_campaign_id);
  return query
  select p.payment_date, p.payment_method, count(*), coalesce(sum(p.amount), 0)::numeric(14,2)::text
  from public.payments p
  where p.campaign_id = p_campaign_id and p.status not in ('draft', 'annulled')
    and (p_collector_id is null or p.collector_id = p_collector_id)
    and (p_method is null or p.payment_method = p_method)
    and (p_from is null or p.payment_date >= p_from)
    and (p_to is null or p.payment_date <= p_to)
  group by p.payment_date, p.payment_method
  order by p.payment_date, p.payment_method;
end $$;

-- Settlements by collector and status. p_from/p_to filter the opening date (Buenos Aires).
create function public.report_settlements_by_collector(
  p_campaign_id uuid,
  p_collector_id uuid default null,
  p_status text default null,
  p_from date default null,
  p_to date default null
) returns table (
  collector_id uuid, collector_name text, status text, settlement_count bigint, total_cash text,
  total_transfer text, total_amount text, commission_amount text, commission_paid_amount text,
  net_to_firefighters text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.report_require_financial(p_campaign_id);
  return query
  select s.collector_id, c.display_name, s.status, count(*),
    coalesce(sum(s.total_cash), 0)::numeric(14,2)::text,
    coalesce(sum(s.total_transfer), 0)::numeric(14,2)::text,
    coalesce(sum(s.total_amount), 0)::numeric(14,2)::text,
    coalesce(sum(s.commission_amount), 0)::numeric(14,2)::text,
    coalesce(sum(s.commission_paid_amount), 0)::numeric(14,2)::text,
    coalesce(sum(s.net_to_firefighters), 0)::numeric(14,2)::text
  from public.settlements s
  join public.collectors c on c.id = s.collector_id
  where s.campaign_id = p_campaign_id
    and (p_collector_id is null or s.collector_id = p_collector_id)
    and (p_status is null or s.status = p_status)
    and (p_from is null or (s.opened_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_from)
    and (p_to is null or (s.opened_at at time zone 'America/Argentina/Buenos_Aires')::date <= p_to)
  group by s.collector_id, c.display_name, s.status
  order by c.display_name, s.collector_id, s.status;
end $$;

-- Current account summary per collector: credits, debits and balance of the non-annulled entries
-- (same rule as collector_ledger_balance). Collectors without entries do not appear.
create function public.report_collector_accounts(
  p_campaign_id uuid,
  p_collector_id uuid default null
) returns table (
  collector_id uuid, collector_name text, entry_count bigint, credit_total text, debit_total text,
  balance text, last_entry_on date
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.report_require_financial(p_campaign_id);
  return query
  select e.collector_id, c.display_name, count(*),
    coalesce(sum(e.amount) filter (where e.direction = 'collector_credit'), 0)::numeric(14,2)::text,
    coalesce(sum(e.amount) filter (where e.direction = 'collector_debit'), 0)::numeric(14,2)::text,
    coalesce(sum(case when e.direction = 'collector_credit' then e.amount else -e.amount end), 0)::numeric(14,2)::text,
    max((e.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date)
  from public.collector_ledger_entries e
  join public.collectors c on c.id = e.collector_id
  where e.campaign_id = p_campaign_id and e.status <> 'annulled'
    and (p_collector_id is null or e.collector_id = p_collector_id)
  group by e.collector_id, c.display_name
  order by c.display_name, e.collector_id;
end $$;

-- Current account detail of one collector, oldest first, with the running balance (annulled
-- entries stay visible but do not move the balance). The balance runs over the whole account, so
-- a date range shows the balance as it was, not a re-based one. Paged with p_limit/p_offset.
create function public.report_collector_ledger(
  p_campaign_id uuid,
  p_collector_id uuid,
  p_from date default null,
  p_to date default null,
  p_limit integer default 1000,
  p_offset integer default 0
) returns table (
  entry_id uuid, occurred_on date, occurred_time text, entry_type text, direction text, amount text,
  status text, settlement_number integer, reason text, running_balance text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.report_require_financial(p_campaign_id);
  if p_collector_id is null then
    raise exception 'collector is required' using errcode = 'invalid_parameter_value';
  end if;
  return query
  select x.id, x.on_date, x.at_time, x.entry_type, x.direction, x.amount::numeric(14,2)::text, x.status,
    x.settlement_number, x.reason, x.balance::numeric(14,2)::text
  from (
    select e.id, e.entry_type, e.direction, e.amount, e.status, e.reason, s.settlement_number,
      (e.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as on_date,
      to_char(e.occurred_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') as at_time,
      e.occurred_at, e.created_at,
      sum(case when e.status = 'annulled' then 0 when e.direction = 'collector_credit' then e.amount else -e.amount end)
        over (order by e.occurred_at, e.created_at, case when e.direction = 'collector_credit' then 0 else 1 end, e.id) as balance
    from public.collector_ledger_entries e
    left join public.settlements s on s.id = e.settlement_id
    where e.campaign_id = p_campaign_id and e.collector_id = p_collector_id
  ) x
  where (p_from is null or x.on_date >= p_from) and (p_to is null or x.on_date <= p_to)
  order by x.occurred_at, x.created_at, case when x.direction = 'collector_credit' then 0 else 1 end, x.id
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end $$;

-- Draws of the campaign with the counts of their frozen roster (null roster_status = no frozen
-- roster yet; the counts are then 0).
create function public.report_draw_rosters(
  p_campaign_id uuid,
  p_draw_id uuid default null
) returns table (
  draw_id uuid, draw_name text, draw_type text, draw_date date, draw_status text,
  roster_status text, eligible_count bigint, ineligible_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.report_require_financial(p_campaign_id);
  return query
  select d.id, d.name, d.draw_type, d.draw_date, d.status, r.status,
    count(e.id) filter (where e.eligible), count(e.id) filter (where not e.eligible)
  from public.draws d
  left join public.draw_rosters r on r.draw_id = d.id and r.status = 'frozen'
  left join public.draw_roster_entries e on e.draw_roster_id = r.id
  where d.campaign_id = p_campaign_id and (p_draw_id is null or d.id = p_draw_id)
  group by d.id, d.name, d.draw_type, d.draw_date, d.status, r.status, d.created_at
  order by d.draw_date, d.created_at, d.id;
end $$;

-- Entries of the frozen roster of one draw (eligible and ineligible numbers), by number.
-- p_eligible = true / false filters; null returns both. Paged with p_limit/p_offset.
create function public.report_draw_roster_entries(
  p_campaign_id uuid,
  p_draw_id uuid,
  p_eligible boolean default null,
  p_limit integer default 1000,
  p_offset integer default 0
) returns table (
  number_value integer, eligible boolean, ineligibility_reason text, buyer_name text, collector_name text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.report_require_financial(p_campaign_id);
  if p_draw_id is null then
    raise exception 'draw is required' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.draws where id = p_draw_id and campaign_id = p_campaign_id) then
    raise exception 'draw % not found', p_draw_id using errcode = 'no_data_found';
  end if;
  return query
  select e.number_value, e.eligible, e.ineligibility_reason,
    coalesce(nullif(btrim(e.buyer_snapshot ->> 'business_name'), ''),
      nullif(btrim(concat_ws(' ', e.buyer_snapshot ->> 'first_name', e.buyer_snapshot ->> 'last_name')), '')),
    nullif(btrim(e.collector_snapshot ->> 'display_name'), '')
  from public.draw_rosters r
  join public.draw_roster_entries e on e.draw_roster_id = r.id
  where r.draw_id = p_draw_id and r.status = 'frozen'
    and (p_eligible is null or e.eligible = p_eligible)
  order by e.number_value, e.id
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end $$;

-- Winners and prizes: one row per prize (annulled prizes included, marked by their status) with
-- the winning number, its result and the awarded bond's buyer and collector.
create function public.report_prizes(
  p_campaign_id uuid,
  p_draw_id uuid default null,
  p_status text default null
) returns table (
  prize_id uuid, draw_id uuid, draw_name text, draw_date date, prize_position integer, prize_name text,
  prize_status text, winning_number integer, result_status text, buyer_name text, collector_name text,
  award_status text, awarded_on date, delivered_on date
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.report_require_financial(p_campaign_id);
  return query
  select pr.id, d.id, d.name, d.draw_date, pr.position, pr.name, pr.status, wn.number_value, wn.result_status,
    coalesce(
      nullif(btrim(e.buyer_snapshot ->> 'business_name'), ''),
      nullif(btrim(concat_ws(' ', e.buyer_snapshot ->> 'first_name', e.buyer_snapshot ->> 'last_name')), ''),
      nullif(btrim(b.business_name), ''),
      nullif(btrim(concat_ws(' ', b.first_name, b.last_name)), '')),
    c.display_name, pa.status,
    (pa.awarded_at at time zone 'America/Argentina/Buenos_Aires')::date,
    (pa.delivered_at at time zone 'America/Argentina/Buenos_Aires')::date
  from public.prizes pr
  join public.draws d on d.id = pr.draw_id and d.campaign_id = p_campaign_id
  left join public.winning_numbers wn on wn.prize_id = pr.id
  left join public.prize_awards pa on pa.prize_id = pr.id and pa.status <> 'annulled'
  left join public.draw_roster_entries e on e.id = wn.matched_roster_entry_id
  left join public.buyers b on b.id = pa.buyer_id
  left join public.collectors c on c.id = pa.collector_id
  where (p_draw_id is null or d.id = p_draw_id) and (p_status is null or pr.status = p_status)
  order by d.draw_date, d.created_at, d.id, pr.position, pr.id;
end $$;

revoke all on function public.report_require_financial(uuid) from public, anon, authenticated;
revoke all on function public.report_payments_by_date(uuid, uuid, text, date, date) from public, anon, service_role;
revoke all on function public.report_settlements_by_collector(uuid, uuid, text, date, date) from public, anon, service_role;
revoke all on function public.report_collector_accounts(uuid, uuid) from public, anon, service_role;
revoke all on function public.report_collector_ledger(uuid, uuid, date, date, integer, integer) from public, anon, service_role;
revoke all on function public.report_draw_rosters(uuid, uuid) from public, anon, service_role;
revoke all on function public.report_draw_roster_entries(uuid, uuid, boolean, integer, integer) from public, anon, service_role;
revoke all on function public.report_prizes(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.report_payments_by_date(uuid, uuid, text, date, date) to authenticated;
grant execute on function public.report_settlements_by_collector(uuid, uuid, text, date, date) to authenticated;
grant execute on function public.report_collector_accounts(uuid, uuid) to authenticated;
grant execute on function public.report_collector_ledger(uuid, uuid, date, date, integer, integer) to authenticated;
grant execute on function public.report_draw_rosters(uuid, uuid) to authenticated;
grant execute on function public.report_draw_roster_entries(uuid, uuid, boolean, integer, integer) to authenticated;
grant execute on function public.report_prizes(uuid, uuid, text) to authenticated;
