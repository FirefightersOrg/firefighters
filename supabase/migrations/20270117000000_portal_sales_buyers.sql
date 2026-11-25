-- SAN-145: collector portal "Mis compradores y ventas" (Phase 16), read-only.
--
-- Narrow SECURITY DEFINER read functions. `buyers_select` stays closed and nothing here writes. Every public function
-- checks `sale.view_own` and only returns rows whose sale belongs to the caller's own collector (is_own_collector):
-- a foreign sale or buyer yields no row, which the app turns into a 404. Buyers expose name, phone and address only.
-- Lists are paginated with a stable order (the ordering columns end in a unique id) and carry `total_count`.
-- Installment status is shown as the bond financial status does: a pending installment past its due date
-- (Buenos Aires today) is overdue even before the nightly job flips it.

-- Internal: own active-plan installments with applied amounts. Not granted to any API role.
-- SECURITY DEFINER blocks inlining, so callers pass the sale ids they need (NULL = all of the collector's sales)
-- and the filter runs inside: a page of 20 sales no longer materializes every installment of the collector.
create function public.portal_own_installments(p_sale_ids uuid[] default null)
returns table (sale_id uuid, installment_id uuid, installment_number integer, due_date date, amount numeric,
               status text, confirmed_amount numeric, pending_amount numeric, balance numeric)
language sql stable security definer set search_path = '' as $$
  select s.id, i.id, i.installment_number, i.due_date, i.amount,
         case when i.status = 'pending' and i.due_date < (now() at time zone 'America/Argentina/Buenos_Aires')::date
              then 'overdue' else i.status end,
         coalesce(a.confirmed, 0), coalesce(a.pending, 0),
         case when i.status in ('paid', 'paid_advance', 'annulled') then 0
              else greatest(i.amount - coalesce(a.confirmed, 0) - coalesce(a.pending, 0), 0) end
  from public.sales s
  join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active'
  join public.installments i on i.payment_plan_id = pp.id
  left join lateral (
    select sum(pi.amount_applied) filter (where p.status = 'confirmed') as confirmed,
           sum(pi.amount_applied) filter (where p.status = 'pending_in_settlement') as pending
    from public.payment_installments pi
    join public.payments p on p.id = pi.payment_id
    where pi.installment_id = i.id
  ) a on true
  where public.is_own_collector(s.collector_id) and (p_sale_ids is null or s.id = any(p_sale_ids));
$$;
revoke all on function public.portal_own_installments(uuid[]) from public, anon, authenticated, service_role;

create function public.portal_require_sale_view_own()
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('sale.view_own') then
    raise exception 'permission denied: sale.view_own is required' using errcode = 'insufficient_privilege';
  end if;
end $$;
revoke all on function public.portal_require_sale_view_own() from public, anon, authenticated, service_role;

-- Own sales, newest first (id breaks ties). Optional campaign filter.
create function public.portal_my_sales(p_campaign_id uuid default null, p_limit integer default 20, p_offset integer default 0)
returns table (sale_id uuid, campaign_id uuid, campaign_name text, number_digits integer, bond_numbers integer[],
               buyer_id uuid, buyer_name text, buyer_phone text, sale_status text, payment_mode text,
               total_amount numeric, paid_amount numeric, pending_amount numeric, balance numeric,
               overdue_count integer, next_due_date date, financial_status text, sold_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.portal_require_sale_view_own();
  return query
  with mine as (
    select s.*, count(*) over () as n
    from public.sales s
    where public.is_own_collector(s.collector_id) and (p_campaign_id is null or s.campaign_id = p_campaign_id)
    order by s.sold_at desc, s.id
    limit greatest(least(coalesce(p_limit, 20), 100), 1) offset greatest(coalesce(p_offset, 0), 0)
  ), totals as (
    -- one pass over the installments of the page's sales only
    select oi.sale_id, sum(oi.confirmed_amount) as confirmed, sum(oi.pending_amount) as pending,
           sum(oi.balance) as balance, count(*) filter (where oi.status = 'overdue') as overdue,
           min(oi.due_date) filter (where oi.status in ('pending', 'overdue')) as next_due
    from public.portal_own_installments(coalesce((select array_agg(m.id) from mine m), '{}'::uuid[])) oi
    group by oi.sale_id
  )
  select m.id, m.campaign_id, c.name, c.number_digits,
         coalesce((select array_agg(bn.number_value order by bn.number_value) from public.bond_numbers bn
                   where bn.bond_id = m.bond_id and bn.number_kind = 'base'), '{}'::integer[]),
         b.id,
         coalesce(b.business_name, nullif(btrim(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, '')), '')),
         b.phone, m.status, m.payment_mode, m.total_amount,
         coalesce(t.confirmed, 0), coalesce(t.pending, 0), coalesce(t.balance, 0),
         coalesce(t.overdue, 0)::integer, t.next_due,
         case when m.status <> 'active' then null else bo.financial_status_snapshot end,
         m.sold_at, m.n
  from mine m
  join public.campaigns c on c.id = m.campaign_id
  join public.buyers b on b.id = m.buyer_id
  join public.bonds bo on bo.id = m.bond_id
  left join totals t on t.sale_id = m.id
  order by m.sold_at desc, m.id;
end $$;

-- One own sale (no row when it does not exist or belongs to someone else).
create function public.portal_my_sale(p_sale_id uuid)
returns table (sale_id uuid, campaign_id uuid, campaign_name text, number_digits integer, bond_numbers integer[],
               buyer_id uuid, buyer_name text, buyer_phone text, buyer_address text, sale_status text,
               payment_mode text, total_amount numeric, paid_amount numeric, pending_amount numeric, balance numeric,
               financial_status text, sold_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.portal_require_sale_view_own();
  return query
  select s.id, s.campaign_id, c.name, c.number_digits,
         coalesce((select array_agg(bn.number_value order by bn.number_value) from public.bond_numbers bn
                   where bn.bond_id = s.bond_id and bn.number_kind = 'base'), '{}'::integer[]),
         b.id,
         coalesce(b.business_name, nullif(btrim(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, '')), '')),
         b.phone, b.address, s.status, s.payment_mode, s.total_amount,
         coalesce(t.confirmed, 0), coalesce(t.pending, 0), coalesce(t.balance, 0),
         case when s.status <> 'active' then null else bo.financial_status_snapshot end, s.sold_at
  from public.sales s
  join public.campaigns c on c.id = s.campaign_id
  join public.buyers b on b.id = s.buyer_id
  join public.bonds bo on bo.id = s.bond_id
  left join lateral (
    select sum(oi.confirmed_amount) as confirmed, sum(oi.pending_amount) as pending, sum(oi.balance) as balance
    from public.portal_own_installments(array[s.id]) oi
  ) t on true
  where s.id = p_sale_id and public.is_own_collector(s.collector_id);
end $$;

-- Installment plan of one own sale.
create function public.portal_my_sale_installments(p_sale_id uuid)
returns table (installment_id uuid, installment_number integer, due_date date, amount numeric, status text,
               confirmed_amount numeric, pending_amount numeric, balance numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.portal_require_sale_view_own();
  return query
  select oi.installment_id, oi.installment_number, oi.due_date, oi.amount, oi.status, oi.confirmed_amount,
         oi.pending_amount, oi.balance
  from public.portal_own_installments(array[p_sale_id]) oi
  where oi.sale_id = p_sale_id
  order by oi.installment_number, oi.installment_id;
end $$;

-- Payments applied to one own sale (annulled and adjusted ones are not shown).
create function public.portal_my_sale_payments(p_sale_id uuid)
returns table (payment_id uuid, payment_date date, amount numeric, payment_method text, status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.portal_require_sale_view_own();
  return query
  select p.id, p.payment_date, p.amount, p.payment_method, p.status
  from public.payments p
  join public.sales s on s.id = p.sale_id
  where p.sale_id = p_sale_id and public.is_own_collector(s.collector_id)
    and p.status in ('draft', 'pending_in_settlement', 'confirmed')
  order by p.payment_date desc, p.created_at desc, p.id;
end $$;

-- Buyers of the own sales, across campaigns: name, phone and address only.
create function public.portal_my_buyers_page(p_limit integer default 20, p_offset integer default 0)
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
    group by b.id, b.business_name, b.first_name, b.last_name, b.phone, b.address
  ), page as (
    select m.*, count(*) over () as n from mine m order by m.name, m.bid
    limit greatest(least(coalesce(p_limit, 20), 100), 1) offset greatest(coalesce(p_offset, 0), 0)
  ), page_sales as (
    select s.id, s.buyer_id from public.sales s
    where s.status = 'active' and public.is_own_collector(s.collector_id)
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

-- One buyer of the own ACTIVE sales (no row otherwise): same visibility as the list, so a buyer whose own sales
-- are all annulled or corrected is not reachable by URL.
create function public.portal_my_buyer(p_buyer_id uuid)
returns table (buyer_id uuid, display_name text, phone text, address text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.portal_require_sale_view_own();
  return query
  select b.id, coalesce(b.business_name, nullif(btrim(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, '')), '')),
         b.phone, b.address
  from public.buyers b
  where b.id = p_buyer_id
    and exists (select 1 from public.sales s
               where s.buyer_id = b.id and s.status = 'active' and public.is_own_collector(s.collector_id));
end $$;

-- Ids of the own sales of one buyer (the page loads each through portal_my_sale).
create function public.portal_my_buyer_sales(p_buyer_id uuid)
returns table (sale_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.portal_require_sale_view_own();
  return query
  select s.id from public.sales s
  where s.buyer_id = p_buyer_id and public.is_own_collector(s.collector_id)
  order by s.sold_at desc, s.id limit 100;
end $$;

-- "Por cobrar": own overdue installments and those due within p_days, most urgent first.
create function public.portal_my_due_installments(p_days integer default 7, p_limit integer default 20, p_offset integer default 0)
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

do $$
declare f text;
begin
  foreach f in array array[
    'portal_my_sales(uuid,integer,integer)', 'portal_my_sale(uuid)', 'portal_my_sale_installments(uuid)',
    'portal_my_sale_payments(uuid)', 'portal_my_buyers_page(integer,integer)', 'portal_my_buyer(uuid)',
    'portal_my_buyer_sales(uuid)', 'portal_my_due_installments(integer,integer,integer)'] loop
    execute format('revoke all on function public.%s from public, anon, service_role', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
