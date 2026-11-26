-- B1 (#50): show the already-authorized address on the collector's due list.
-- Append the output column; retain the existing scope, ordering, pagination and grants.
drop function public.portal_my_campaign_due_installments(uuid, integer, integer, integer);

create function public.portal_my_campaign_due_installments(p_campaign_id uuid, p_days integer default 7, p_limit integer default 20, p_offset integer default 0)
returns table (sale_id uuid, campaign_id uuid, campaign_name text, number_digits integer, bond_numbers integer[],
               buyer_id uuid, buyer_name text, buyer_phone text, installment_id uuid, installment_number integer,
               due_date date, amount numeric, status text, pending_amount numeric, balance numeric, total_count bigint, buyer_address text)
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
         b.phone, d.installment_id, d.installment_number, d.due_date, d.amount, d.status, d.pending_amount, d.balance, d.n, b.address
  from due d
  join public.sales s on s.id = d.sale_id
  join public.campaigns c on c.id = s.campaign_id
  join public.buyers b on b.id = s.buyer_id
  order by d.due_date, d.installment_id;
end $$;

revoke all on function public.portal_my_campaign_due_installments(uuid, integer, integer, integer) from public, anon, service_role;
grant execute on function public.portal_my_campaign_due_installments(uuid, integer, integer, integer) to authenticated;

-- Compatibility exception approved for B1: the legacy RPC retains its original 16 columns.
-- SELECT * would now return an extra column and fail its declared return type at execution.
create or replace function public.portal_my_due_installments(p_days integer default 7, p_limit integer default 20, p_offset integer default 0)
returns table (sale_id uuid, campaign_id uuid, campaign_name text, number_digits integer, bond_numbers integer[],
               buyer_id uuid, buyer_name text, buyer_phone text, installment_id uuid, installment_number integer,
               due_date date, amount numeric, status text, pending_amount numeric, balance numeric, total_count bigint)
language sql stable security definer set search_path = '' as $$
  select sale_id, campaign_id, campaign_name, number_digits, bond_numbers,
         buyer_id, buyer_name, buyer_phone, installment_id, installment_number,
         due_date, amount, status, pending_amount, balance, total_count
  from public.portal_my_campaign_due_installments(null::uuid, p_days, p_limit, p_offset);
$$;

revoke all on function public.portal_my_due_installments(integer, integer, integer) from public, anon, service_role;
grant execute on function public.portal_my_due_installments(integer, integer, integer) to authenticated;
