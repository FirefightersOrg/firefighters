-- SAN-106 (part a): the first-due-date window, decided by Santiago (2026-11-19, #50) and closed by Juan
-- (2026-11-25, #50, answer 3): a sale may be registered with an EARLIER sale date (whoever may register
-- sales: sale.create, i.e. admin or operator), never in the future nor (when earlier) before the campaign start (Buenos
-- Aires dates). The first due date must fall within [sale date, sale date + 1 year]; this replaces
-- SAN-59's provisional "31 days before today". An earlier sale is stamped at 12:00 Buenos Aires of its date
-- (sold_at), so monthly reports count it in its month; a sale of today keeps now().
--
-- Signature: p_sale_date is appended (named calls only), so the old overload is dropped first.

drop function public.sale_register(uuid, uuid, uuid, text, date, text);

create function public.sale_register(
  p_campaign_id uuid,
  p_bond_id uuid,
  p_buyer_id uuid,
  p_payment_mode text,
  p_first_due_date date default null,
  p_request_id text default null,
  p_sale_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.bond_require_actor('sale.create');
  v_campaign public.campaigns;
  v_bond public.bonds;
  v_sale_id uuid;
  v_plan_id uuid;
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_sale_date date := coalesce(p_sale_date, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
  v_first_due_date date := coalesce(p_first_due_date, p_sale_date, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
  v_sold_at timestamptz;
  v_count integer;
  v_amount numeric(12,2);
begin
  if p_payment_mode not in ('full_payment', 'installments') then
    raise exception 'payment mode must be full_payment or installments' using errcode = 'invalid_parameter_value';
  end if;
  if v_sale_date > v_today then
    raise exception 'sale date cannot be in the future' using errcode = 'invalid_parameter_value';
  end if;
  if v_first_due_date < v_sale_date or v_first_due_date > v_sale_date + 365 then
    raise exception 'first due date must be between the sale date and one year after it'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_campaign from public.campaigns where id = p_campaign_id for share;
  if not found then
    raise exception 'campaign % not found', p_campaign_id using errcode = 'no_data_found';
  end if;
  if v_campaign.status <> 'active' then
    raise exception 'campaign must be active to register a sale (status: %)', v_campaign.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  -- Only an explicit earlier date is bounded by the campaign start: a sale of today keeps working in an
  -- active campaign whose official start is still ahead (as before).
  if p_sale_date is not null and v_sale_date < v_today and v_campaign.starts_at is not null
     and v_sale_date < (v_campaign.starts_at at time zone 'America/Argentina/Buenos_Aires')::date then
    raise exception 'sale date cannot be before the campaign start' using errcode = 'invalid_parameter_value';
  end if;
  -- Today keeps the real instant; an earlier sale is stamped at noon (Buenos Aires) of its date.
  v_sold_at := case when v_sale_date = v_today then now()
    else (v_sale_date + time '12:00') at time zone 'America/Argentina/Buenos_Aires' end;
  select * into v_bond from public.bonds where id = p_bond_id for update;
  if not found then
    raise exception 'bond % not found', p_bond_id using errcode = 'no_data_found';
  end if;
  if v_bond.campaign_id <> p_campaign_id then
    raise exception 'bond belongs to another campaign' using errcode = 'invalid_parameter_value';
  end if;
  if v_bond.commercial_status <> 'delivered_to_collector' then
    raise exception 'bond % is % and cannot be sold (only bonds delivered to a collector)',
      public.bond_label(v_bond.id, v_campaign.number_digits), v_bond.commercial_status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v_bond.current_collector_id is null then
    raise exception 'delivered bond has no collector' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if exists (
    select 1 from public.bond_groups g
    where g.member_bond_id = v_bond.id and g.ungrouped_at is null
  ) then
    raise exception 'bond belongs to a manually grouped pata and cannot be sold individually'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  perform 1 from public.buyers where id = p_buyer_id for share;
  if not found then
    raise exception 'buyer % not found', p_buyer_id using errcode = 'no_data_found';
  end if;

  if p_payment_mode = 'full_payment' then
    v_count := 1;
    v_amount := v_bond.total_value;
  else
    v_count := v_campaign.installment_count;
    v_amount := v_campaign.installment_value * v_bond.commercial_unit_count;
    if v_amount * v_count <> v_bond.total_value then
      raise exception 'campaign installment schedule does not equal bond total' using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;

  insert into public.sales (campaign_id, bond_id, buyer_id, collector_id, sold_at, payment_mode, total_amount, created_by)
  values (p_campaign_id, p_bond_id, p_buyer_id, v_bond.current_collector_id, v_sold_at, p_payment_mode, v_bond.total_value, v_actor)
  returning id into v_sale_id;
  insert into public.payment_plans (sale_id, installment_count, total_amount)
  values (v_sale_id, v_count, v_bond.total_value) returning id into v_plan_id;
  insert into public.installments (payment_plan_id, installment_number, due_date, amount)
  select v_plan_id, n, (v_first_due_date + ((n - 1) * interval '1 month'))::date, v_amount
  from generate_series(1, v_count) as n;

  update public.bonds
  set commercial_status = 'sold', current_buyer_id = p_buyer_id, financial_status_snapshot = 'no_payments'
  where id = p_bond_id;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'sale.create', 'sale', v_sale_id::text,
    jsonb_build_object('bond_id', p_bond_id, 'buyer_id', p_buyer_id, 'collector_id', v_bond.current_collector_id,
      'payment_mode', p_payment_mode, 'total_amount', v_bond.total_value, 'installment_count', v_count,
      'first_due_date', v_first_due_date, 'sale_date', v_sale_date), p_request_id);
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, request_id)
  values (v_actor, 'sale.create', 'bond', p_bond_id::text,
    jsonb_build_object('commercial_status', 'delivered_to_collector', 'current_buyer_id', v_bond.current_buyer_id),
    jsonb_build_object('commercial_status', 'sold', 'current_buyer_id', p_buyer_id,
      'financial_status_snapshot', 'no_payments'), p_request_id);
  return v_sale_id;
exception when unique_violation then
  raise exception 'bond is already sold' using errcode = 'object_not_in_prerequisite_state';
end;
$$;

revoke all on function public.sale_register(uuid, uuid, uuid, text, date, text, date)
  from public, anon, authenticated, service_role;
grant execute on function public.sale_register(uuid, uuid, uuid, text, date, text, date) to authenticated;
comment on function public.sale_register(uuid, uuid, uuid, text, date, text, date) is
  'Registers an active-campaign sale of a delivered bond, its plan and installments (optionally with an earlier sale date); returns the sale id.';
