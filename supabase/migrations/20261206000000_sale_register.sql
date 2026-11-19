-- SAN-59: audited registration of a sale and its initial payment schedule.
create function public.sale_register(
  p_campaign_id uuid,
  p_bond_id uuid,
  p_buyer_id uuid,
  p_payment_mode text,
  p_first_due_date date default null,
  p_request_id text default null
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
  v_sale_date date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_first_due_date date := coalesce(p_first_due_date, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
  v_count integer;
  v_amount numeric(12,2);
begin
  if p_payment_mode not in ('full_payment', 'installments') then
    raise exception 'payment mode must be full_payment or installments' using errcode = 'invalid_parameter_value';
  end if;
  if v_first_due_date < v_sale_date - 31 or v_first_due_date > v_sale_date + 365 then
    raise exception 'first due date must be between 31 days before the sale and one year ahead'
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

  insert into public.sales (campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
  values (p_campaign_id, p_bond_id, p_buyer_id, v_bond.current_collector_id, p_payment_mode, v_bond.total_value, v_actor)
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
      'first_due_date', v_first_due_date), p_request_id);
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

revoke all on function public.sale_register(uuid, uuid, uuid, text, date, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sale_register(uuid, uuid, uuid, text, date, text) to authenticated;
comment on function public.sale_register(uuid, uuid, uuid, text, date, text) is
  'Registers an active-campaign sale of a delivered bond, its plan and installments; returns the sale id.';
