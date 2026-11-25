-- SAN-149 (found while exporting the SAN-142 list): report_overdue_sales labelled the bond with
-- public.bond_label, which is meant for error messages and appends the bond UUID ("0077 (<uuid>)").
-- The report (screen and export) now shows the bond's base numbers only, formatted with the campaign's
-- digits and comma-separated for a pata ("0012, 0013"), or '—'. Everything else is unchanged from
-- 20270116000000; grants are kept by CREATE OR REPLACE.

create or replace function public.report_overdue_sales(
  p_campaign_id uuid,
  p_collector_id uuid default null,
  p_limit integer default null,
  p_offset integer default 0
) returns table (
  sale_id uuid, bond_id uuid, bond_label text, collector_id uuid, collector_name text,
  overdue_count bigint, overdue_amount text, oldest_due_date date, threshold integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_campaign public.campaigns;
begin
  perform public.report_require_operational(p_campaign_id);
  select * into v_campaign from public.campaigns where id = p_campaign_id;
  return query
  select s.id, s.bond_id, coalesce((select string_agg(public.bond_format_number(n.number_value, v_campaign.number_digits), ', '
      order by n.number_value) from public.bond_numbers n
      where n.bond_id = s.bond_id and n.number_kind = 'base' and n.released_at is null), '—'), s.collector_id,
    c.display_name, count(*), sum(i.amount)::numeric(14,2)::text, min(i.due_date),
    v_campaign.overdue_warning_threshold
  from public.sales s
  join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active'
  join public.installments i on i.payment_plan_id = pp.id
  join public.collectors c on c.id = s.collector_id
  where s.campaign_id = p_campaign_id and s.status = 'active' and s.uncollectible_at is null
    and (i.status = 'overdue' or (i.status = 'pending' and i.due_date < v_today))
    and (p_collector_id is null or s.collector_id = p_collector_id)
  group by s.id, s.bond_id, s.collector_id, c.display_name
  having count(*) >= v_campaign.overdue_warning_threshold
  order by count(*) desc, min(i.due_date), s.id
  -- Paged like the financial reports: PostgREST caps a response at 1000 rows.
  limit p_limit offset greatest(coalesce(p_offset, 0), 0);
end $$;

