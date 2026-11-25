-- SAN-148: campaign-scoped portal (/portal/[campaignId]/...). Two functions with an optional campaign filter
-- (portal_my_sales already has one): `portal_my_campaign_buyers` and `portal_my_campaign_due_installments`. The SAN-145
-- functions keep their signature and now delegate to these with a NULL campaign. Same checks as before:
-- `sale.view_own` and own collector only; granted to `authenticated` only.

create function public.portal_my_campaign_buyers(p_campaign_id uuid, p_limit integer default 20, p_offset integer default 0)
returns table (buyer_id uuid, display_name text, phone text, address text, sale_count bigint, balance numeric, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.portal_require_sale_view_own();
  return query
  with mine as (
    select b.id as bid,
           coalesce(b.business_name, nullif(btrim(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, '')), '')) as name,
           b.phone as ph, b.address as ad, count(*) as sales
    from public.sales s join public.buyers b on b.id = s.buyer_id
    where s.status = 'active' and public.is_own_collector(s.collector_id)
      and (p_campaign_id is null or s.campaign_id = p_campaign_id)
    group by b.id, b.business_name, b.first_name, b.last_name, b.phone, b.address
  ), page as (
    select m.*, count(*) over () as n from mine m order by m.name, m.bid
    limit greatest(least(coalesce(p_limit, 20), 100), 1) offset greatest(coalesce(p_offset, 0), 0)
  ), page_sales as (
    select s.id, s.buyer_id from public.sales s
    where s.status = 'active' and public.is_own_collector(s.collector_id)
      and (p_campaign_id is null or s.campaign_id = p_campaign_id)
      and s.buyer_id in (select pp.bid from page pp)
  ), balances as (
    -- one pass over the installments of the page's buyers only
    select ps.buyer_id, sum(oi.balance) as balance
    from public.portal_own_installments(coalesce((select array_agg(x.id) from page_sales x), '{}'::uuid[])) oi
    join page_sales ps on ps.id = oi.sale_id
    group by ps.buyer_id
  )
  select pg.bid, pg.name, pg.ph, pg.ad, pg.sales, coalesce(bl.balance, 0), pg.n
  from page pg
  left join balances bl on bl.buyer_id = pg.bid
  order by pg.name, pg.bid;
end $$;

create function public.portal_my_campaign_due_installments(p_campaign_id uuid, p_days integer default 7, p_limit integer default 20, p_offset integer default 0)
returns table (sale_id uuid, campaign_id uuid, campaign_name text, number_digits integer, bond_numbers integer[],
               buyer_id uuid, buyer_name text, buyer_phone text, installment_id uuid, installment_number integer,
               due_date date, amount numeric, status text, pending_amount numeric, balance numeric, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.portal_require_sale_view_own();
  return query
  with due as (
    select oi.*, count(*) over () as n
    from public.portal_own_installments() oi
    join public.sales s on s.id = oi.sale_id and s.status = 'active'
      and (p_campaign_id is null or s.campaign_id = p_campaign_id)
    where oi.status in ('pending', 'overdue') and oi.balance > 0
      and oi.due_date <= (now() at time zone 'America/Argentina/Buenos_Aires')::date + greatest(least(coalesce(p_days, 7), 90), 0)
    order by oi.due_date, oi.installment_id
    limit greatest(least(coalesce(p_limit, 20), 100), 1) offset greatest(coalesce(p_offset, 0), 0)
  )
  select s.id, s.campaign_id, c.name, c.number_digits,
         coalesce((select array_agg(bn.number_value order by bn.number_value) from public.bond_numbers bn
                   where bn.bond_id = s.bond_id and bn.number_kind = 'base'), '{}'::integer[]),
         b.id,
         coalesce(b.business_name, nullif(btrim(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, '')), '')),
         b.phone, d.installment_id, d.installment_number, d.due_date, d.amount, d.status, d.pending_amount, d.balance, d.n
  from due d
  join public.sales s on s.id = d.sale_id
  join public.campaigns c on c.id = s.campaign_id
  join public.buyers b on b.id = s.buyer_id
  order by d.due_date, d.installment_id;
end $$;

create or replace function public.portal_my_buyers_page(p_limit integer default 20, p_offset integer default 0)
returns table (buyer_id uuid, display_name text, phone text, address text, sale_count bigint, balance numeric, total_count bigint)
language sql stable security definer set search_path = '' as $$
  select * from public.portal_my_campaign_buyers(null::uuid, p_limit, p_offset);
$$;

create or replace function public.portal_my_due_installments(p_days integer default 7, p_limit integer default 20, p_offset integer default 0)
returns table (sale_id uuid, campaign_id uuid, campaign_name text, number_digits integer, bond_numbers integer[],
               buyer_id uuid, buyer_name text, buyer_phone text, installment_id uuid, installment_number integer,
               due_date date, amount numeric, status text, pending_amount numeric, balance numeric, total_count bigint)
language sql stable security definer set search_path = '' as $$
  select * from public.portal_my_campaign_due_installments(null::uuid, p_days, p_limit, p_offset);
$$;

revoke all on function public.portal_my_campaign_buyers(uuid, integer, integer) from public, anon, service_role;
grant execute on function public.portal_my_campaign_buyers(uuid, integer, integer) to authenticated;
revoke all on function public.portal_my_campaign_due_installments(uuid, integer, integer, integer) from public, anon, service_role;
grant execute on function public.portal_my_campaign_due_installments(uuid, integer, integer, integer) to authenticated;
