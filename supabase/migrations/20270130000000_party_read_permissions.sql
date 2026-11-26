insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.name in ('treasurer', 'read-only') and p.code in ('buyer.view', 'collector.view')
on conflict (role_id, permission_id) do nothing;

create or replace function public.settlement_add_payment(
  p_settlement_id uuid, p_sale_id uuid, p_amount numeric, p_payment_method text,
  p_applications jsonb, p_payment_date date default null, p_request_id text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settlement_require_actor('payment.create');
  v_set public.settlements;
  v_sale public.sales;
  v_id uuid;
  v_sum numeric := 0;
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  x jsonb;
  v_installment uuid;
  v_applied numeric;
begin
  select * into v_set from public.settlements where id = p_settlement_id for update;
  if not found then
    raise exception 'settlement % not found', p_settlement_id using errcode = 'no_data_found';
  end if;
  if v_set.status <> 'open' then
    raise exception 'settlement must be open' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'
    or p_payment_method not in ('cash', 'transfer') then
    raise exception 'invalid payment amount or method' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_sale from public.sales where id = p_sale_id for share;
  if not found then
    raise exception 'sale % not found', p_sale_id using errcode = 'no_data_found';
  end if;
  if v_sale.campaign_id <> v_set.campaign_id
    or v_sale.collector_id <> v_set.collector_id
    or v_sale.status <> 'active' then
    raise exception 'sale must be active and belong to the settlement collector and campaign'
      using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_applications) <> 'array' or jsonb_array_length(p_applications) = 0 then
    raise exception 'applications are required' using errcode = 'invalid_parameter_value';
  end if;
  if p_payment_date > v_today then
    raise exception 'payment date cannot be in the future' using errcode = 'invalid_parameter_value';
  end if;
  if p_payment_date < (v_sale.sold_at at time zone 'America/Argentina/Buenos_Aires')::date then
    raise exception 'payment date cannot be before the sale date' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.payments (
    campaign_id, sale_id, collector_id, buyer_id, settlement_id, amount,
    payment_method, payment_date, status, created_by
  )
  values (
    v_set.campaign_id, p_sale_id, v_set.collector_id, v_sale.buyer_id, p_settlement_id,
    p_amount, p_payment_method, coalesce(p_payment_date, v_today), 'pending_in_settlement', v_actor
  )
  returning id into v_id;
  -- Lock installments in a stable order (by id) so concurrent adds cannot deadlock.
  for x in select value from jsonb_array_elements(p_applications) order by value ->> 'installment_id' loop
    begin
      v_installment := (x ->> 'installment_id')::uuid;
      v_applied := (x ->> 'amount_applied')::numeric;
    exception when others then
      raise exception 'invalid payment application' using errcode = 'invalid_parameter_value';
    end;
    if v_applied is null or v_applied <= 0 then
      raise exception 'application amount must be positive' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.payment_installments (payment_id, installment_id, amount_applied)
    values (v_id, v_installment, v_applied);
    v_sum := v_sum + v_applied;
  end loop;
  if v_sum <> p_amount then
    raise exception 'payment applications must equal the payment amount'
      using errcode = 'invalid_parameter_value';
  end if;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'payment.add', 'payment', v_id::text,
    jsonb_build_object('settlement_id', p_settlement_id, 'amount', p_amount, 'method', p_payment_method, 'payment_date', coalesce(p_payment_date, v_today)), p_request_id);
  return v_id;
end $$;

revoke all on function public.settlement_add_payment(uuid,uuid,numeric,text,jsonb,date,text) from public, anon, service_role;
grant execute on function public.settlement_add_payment(uuid,uuid,numeric,text,jsonb,date,text) to authenticated;
