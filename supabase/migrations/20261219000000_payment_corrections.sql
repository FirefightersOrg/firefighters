-- SAN-71: corrections preserve payment/application/settlement and ledger history.
alter table public.payments add column replaces_payment_id uuid
  references public.payments(id) on delete restrict;
create unique index payments_replaces_payment_id_key on public.payments(replaces_payment_id)
  where replaces_payment_id is not null;

-- The private RPC sets this transaction-local value to the ORIGINAL payment id, not a
-- general bypass. API roles have no DML grants; setting a custom GUC alone grants nothing.
create or replace function public.payments_guard_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.replaces_payment_id is not null then
    if current_setting('app.payment_correction',true) is distinct from new.replaces_payment_id::text
      or new.status <> 'confirmed' or not exists (
        select 1 from public.payments p where p.id=new.replaces_payment_id and p.status='adjusted'
          and (p.campaign_id,p.collector_id,p.settlement_id,p.amount,p.payment_date)
            is not distinct from
              (new.campaign_id,new.collector_id,new.settlement_id,new.amount,new.payment_date)
      ) then
      raise exception 'replacement payments require an audited correction' using errcode='check_violation';
    end if;
    return new;
  end if;
  perform public.payments_check_settlement(new.settlement_id,new.collector_id);
  if new.status not in ('draft','pending_in_settlement') then
    raise exception 'a new payment must start draft or pending_in_settlement' using errcode='check_violation';
  end if;
  if (new.status='pending_in_settlement') is distinct from (new.settlement_id is not null) then
    raise exception 'pending payment settlement is inconsistent' using errcode='check_violation';
  end if;
  return new;
end $$;

create function public.payment_correction_guard_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.replaces_payment_id is distinct from old.replaces_payment_id then
    raise exception 'replacement link is immutable' using errcode='restrict_violation';
  end if;
  if old.status='confirmed' and new.status in ('adjusted','annulled')
    and current_setting('app.payment_correction',true) is distinct from old.id::text then
    raise exception 'confirmed payment corrections require an audited RPC' using errcode='restrict_violation';
  end if;
  return new;
end $$;
create trigger payment_correction_guard_update before update on public.payments
  for each row execute function public.payment_correction_guard_update();

-- Only installments belonging to this correction may revert; identity remains immutable.
create or replace function public.installments_guard_update() returns trigger
language plpgsql set search_path = '' as $$
declare v_correction boolean;
begin
  if (new.id,new.payment_plan_id,new.installment_number,new.due_date,new.amount)
    is distinct from (old.id,old.payment_plan_id,old.installment_number,old.due_date,old.amount) then
    raise exception 'only the status of an installment can change' using errcode='restrict_violation';
  end if;
  v_correction:=exists (
    select 1 from public.payment_installments pi join public.payments p on p.id=pi.payment_id
    where pi.installment_id=old.id and
      (p.id::text=current_setting('app.payment_correction',true)
       or p.replaces_payment_id::text=current_setting('app.payment_correction',true))
  );
  if new.status is distinct from old.status and not (
    (old.status='pending' and new.status in ('paid','paid_advance','overdue'))
    or (old.status='overdue' and new.status='paid')
    or (old.status in ('paid','paid_advance') and new.status='annulled')
    or (v_correction and old.status in ('paid','paid_advance') and new.status in ('pending','overdue'))
    or (v_correction and old.status='overdue' and new.status='paid_advance')
  ) then
    raise exception 'installment status cannot go from % to %',old.status,new.status using errcode='check_violation';
  end if;
  new.updated_at:=now(); return new;
end $$;

create or replace function public.payment_installments_guard_insert() returns trigger
language plpgsql set search_path = '' as $$
declare v_payment public.payments; v_plan uuid; v_amount numeric; v_applied numeric;
begin
  select * into v_payment from public.payments where id=new.payment_id for update;
  if v_payment.status not in ('draft','pending_in_settlement') and not (
    v_payment.status='confirmed' and v_payment.replaces_payment_id is not null
    and current_setting('app.payment_correction',true) is not distinct from v_payment.replaces_payment_id::text
  ) then
    raise exception 'payment applications require a draft or pending payment' using errcode='check_violation';
  end if;
  select coalesce(sum(amount_applied),0) into v_applied from public.payment_installments where payment_id=new.payment_id;
  if v_applied+new.amount_applied>v_payment.amount then
    raise exception 'payment applications exceed the payment amount' using errcode='check_violation';
  end if;
  select payment_plan_id,amount into v_plan,v_amount from public.installments where id=new.installment_id for update;
  if v_payment.sale_id is null or v_plan is null or not exists (
    select 1 from public.payment_plans where id=v_plan and sale_id=v_payment.sale_id and status='active'
  ) then raise exception 'installment must belong to the payment sale active plan' using errcode='check_violation'; end if;
  -- Adjusted applications, like annulled applications, are history, not coverage.
  select coalesce(sum(pi.amount_applied),0) into v_applied
    from public.payment_installments pi join public.payments p on p.id=pi.payment_id
    where pi.installment_id=new.installment_id and p.status not in ('annulled','adjusted');
  if v_applied+new.amount_applied>v_amount then
    raise exception 'payment applications exceed installment amount' using errcode='check_violation';
  end if;
  return new;
end $$;

create function public.payment_correction_commission(p_payment_id uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  -- Recomputed at payment_date with CURRENT rules. Persisting applied-rule ids is a follow-up.
  select coalesce(sum(public.settlement_application_commission(
    p.campaign_id,p.collector_id,p.payment_date,s.payment_mode,i.installment_number,
    pp.installment_count,pi.amount_applied,i.amount)),0)
  from public.payments p join public.sales s on s.id=p.sale_id
  join public.payment_installments pi on pi.payment_id=p.id
  join public.installments i on i.id=pi.installment_id
  join public.payment_plans pp on pp.id=i.payment_plan_id where p.id=p_payment_id;
$$;

-- One private implementation keeps validation, lock order, audit and compensation identical.
create function public.payment_apply_correction(
  p_type text,p_payment_id uuid,p_new_method text,p_new_sale_id uuid,
  p_applications jsonb,p_reason text,p_request_id text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settlement_require_actor('payment.annul');
  v_reason text := nullif(btrim(p_reason),'');
  v_old public.payments; v_new public.payments; v_set public.settlements; v_sale public.sales;
  v_apps jsonb; v_ids uuid[]; v_id uuid; v_result uuid; v_sum numeric:=0; v_amount numeric;
  v_old_comm numeric; v_movements jsonb:='[]';
  v_flag text := current_setting('app.payment_correction',true);
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  x jsonb; r record; v_previous jsonb;
begin
  if v_reason is null or char_length(v_reason)>1000 then
    raise exception 'a trimmed reason of at most 1000 characters is required' using errcode='invalid_parameter_value';
  end if;
  if p_type not in ('annul','correct_method','reassociate_transfer') or p_type is null then
    raise exception 'invalid correction type' using errcode='invalid_parameter_value';
  end if;
  select * into v_old from public.payments where id=p_payment_id;
  if not found then raise exception 'payment not found' using errcode='no_data_found'; end if;
  -- Settlement -> payment -> ALL old/new installments ordered by id -> ledger lock.
  select * into v_set from public.settlements where id=v_old.settlement_id for update;
  select * into v_old from public.payments where id=p_payment_id for update;
  if not (v_old.status='confirmed' or
    (p_type='annul' and v_old.status='pending_in_settlement' and v_set.status='open')) then
    raise exception 'payment is not eligible for this correction' using errcode='object_not_in_prerequisite_state';
  end if;
  if p_type='correct_method' and (p_new_method is null or p_new_method not in ('cash','transfer') or p_new_method=v_old.payment_method) then
    raise exception 'a different valid payment method is required' using errcode='invalid_parameter_value';
  end if;
  if p_type='reassociate_transfer' then
    if v_old.payment_method<>'transfer' or p_new_sale_id is null or p_new_sale_id=v_old.sale_id then
      raise exception 'reassociation requires a transfer and a different sale' using errcode='invalid_parameter_value';
    end if;
    select * into v_sale from public.sales where id=p_new_sale_id for share;
    if not found then raise exception 'sale not found' using errcode='no_data_found'; end if;
    if v_sale.status<>'active' or (v_sale.campaign_id,v_sale.collector_id) is distinct from (v_old.campaign_id,v_old.collector_id) then
      raise exception 'sale must be active and have the same campaign and collector' using errcode='invalid_parameter_value';
    end if;
    v_apps:=p_applications;
  else
    select * into v_sale from public.sales where id=v_old.sale_id;
    select jsonb_agg(jsonb_build_object('installment_id',installment_id,'amount_applied',amount_applied))
      into v_apps from public.payment_installments where payment_id=p_payment_id;
  end if;
  if v_apps is null or jsonb_typeof(v_apps)<>'array' then
    raise exception 'applications must be a nonempty array' using errcode='invalid_parameter_value';
  end if;
  if jsonb_array_length(v_apps)=0 then
    raise exception 'applications must be a nonempty array' using errcode='invalid_parameter_value';
  end if;
  for x in select value from jsonb_array_elements(v_apps) loop
    begin v_id:=(x->>'installment_id')::uuid; v_amount:=(x->>'amount_applied')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid payment application' using errcode='invalid_parameter_value';
    end;
    if v_id is null or v_amount is null or v_amount<=0 or v_amount='NaN'
      or v_amount>=10000000000 or v_amount<>round(v_amount,2) or v_id=any(coalesce(v_ids,'{}')) then
      raise exception 'invalid or duplicate payment application' using errcode='invalid_parameter_value';
    end if;
    v_ids:=array_append(v_ids,v_id); v_sum:=v_sum+v_amount;
  end loop;
  if v_sum<>v_old.amount then
    raise exception 'applications must equal payment amount' using errcode='invalid_parameter_value';
  end if;
  perform i.id from public.installments i where i.id=any(v_ids) or i.id in (
    select installment_id from public.payment_installments where payment_id=p_payment_id
  ) order by i.id for update;
  -- Validate destination against ALL live reservations, not just confirmed coverage.
  if p_type='reassociate_transfer' then
    for x in select value from jsonb_array_elements(v_apps) loop
      if not exists (
        select 1 from public.installments i join public.payment_plans pp on pp.id=i.payment_plan_id
        where i.id=(x->>'installment_id')::uuid and pp.sale_id=v_sale.id and pp.status='active'
          and i.status<>'annulled' and (x->>'amount_applied')::numeric<=i.amount-coalesce((
            select sum(pi.amount_applied) from public.payment_installments pi
            join public.payments p on p.id=pi.payment_id where pi.installment_id=i.id
              and p.status not in ('annulled','adjusted')
          ),0)
      ) then raise exception 'invalid destination installment or insufficient remaining amount' using errcode='invalid_parameter_value'; end if;
    end loop;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_old.campaign_id::text||v_old.collector_id::text,68));
  v_old_comm:=public.payment_correction_commission(p_payment_id);
  v_previous:=jsonb_build_object('payment',to_jsonb(v_old),'applications',(
    select jsonb_agg(to_jsonb(pi)) from public.payment_installments pi where payment_id=p_payment_id));
  perform set_config('app.payment_correction',p_payment_id::text,true);
  if p_type='annul' then
    update public.payments set status='annulled',annulled_by=v_actor,annulled_at=now(),annulment_reason=v_reason
      where id=p_payment_id returning * into v_new;
    v_result:=p_payment_id;
  else
    update public.payments set status='adjusted' where id=p_payment_id;
    insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,payment_date,status,created_by,replaces_payment_id)
      values(v_old.campaign_id,v_sale.id,v_old.collector_id,
        case when p_type='correct_method' then v_old.buyer_id else v_sale.buyer_id end,v_old.settlement_id,v_old.amount,
        case when p_type='correct_method' then p_new_method else 'transfer' end,
        v_old.payment_date,'confirmed',v_actor,p_payment_id) returning * into v_new;
    v_result:=v_new.id;
    insert into public.payment_installments(payment_id,installment_id,amount_applied)
      select v_result,(value->>'installment_id')::uuid,(value->>'amount_applied')::numeric
      from jsonb_array_elements(v_apps) order by value->>'installment_id';
  end if;
  -- Method changes preserve coverage and installment statuses exactly.
  if p_type<>'correct_method' and v_old.status='confirmed' then
    for r in select i.* from public.installments i where i.id=any(v_ids) or i.id in (
      select installment_id from public.payment_installments where payment_id=p_payment_id
    ) order by i.id loop
      select coalesce(sum(pi.amount_applied),0) into v_amount from public.payment_installments pi
        join public.payments p on p.id=pi.payment_id where pi.installment_id=r.id and p.status='confirmed';
      update public.installments set status=case when v_amount>=r.amount then
        case when r.due_date>v_today then 'paid_advance' else 'paid' end
        else case when r.due_date<v_today then 'overdue' else 'pending' end end
        where id=r.id and status<>'annulled';
    end loop;
    update public.bonds b set financial_status_snapshot=public.bond_financial_status_from_installments(b.id)
      where b.id in (select bond_id from public.sales where id in (v_old.sale_id,v_sale.id));
  end if;
  perform set_config('app.payment_correction',coalesce(v_flag,''),true);
  -- Every compensating row uses annulment, including replacement commission credits.
  -- No principal cash/transfer ledger entries (SAN-68); zero commission writes no row.
  for r in
    select p_payment_id payment_id,'collector_debit' direction,v_old_comm amount
      where v_old.status='confirmed' and p_type in ('annul','reassociate_transfer')
    union all select p_payment_id,'collector_credit',v_old_comm
      where v_old.status='confirmed' and v_old.payment_method='cash' and p_type in ('annul','correct_method')
    union all select v_result,'collector_debit',v_old_comm
      where p_type='correct_method' and p_new_method='cash'
    union all select v_result,'collector_credit',public.payment_correction_commission(v_result)
      where p_type='reassociate_transfer'
  loop
    if r.amount>0 then
      insert into public.collector_ledger_entries(campaign_id,collector_id,settlement_id,payment_id,entry_type,direction,amount,reason,created_by)
        values(v_old.campaign_id,v_old.collector_id,v_old.settlement_id,r.payment_id,'annulment',r.direction,r.amount,v_reason,v_actor)
        returning id into v_id;
      v_movements:=v_movements||jsonb_build_array(v_id);
    end if;
  end loop;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,reason,request_id)
    values(v_actor,'payment.'||p_type,'payment',p_payment_id::text,v_previous,
      jsonb_build_object('correction_type',p_type,'affected_entity',jsonb_build_object('type','payment','id',p_payment_id),
        'related_entity',jsonb_build_object('type',case when p_type='annul' then 'settlement' else 'payment' end,
          'id',case when p_type='annul' then v_old.settlement_id else v_result end),
        'reason',v_reason,'user',v_actor,'date',now(),'previous_value',v_previous,
        'new_value',jsonb_build_object('original_status',case when p_type='annul' then 'annulled' else 'adjusted' end,
          'payment',to_jsonb(v_new),'applications',v_apps),'generated_compensatory_movements',v_movements),
      v_reason,p_request_id);
  return v_result;
end $$;

create function public.payment_annul(p_payment_id uuid,p_reason text,p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin perform public.payment_apply_correction('annul',p_payment_id,null,null,null,p_reason,p_request_id); end $$;
create function public.payment_correct_method(p_payment_id uuid,p_new_method text,p_reason text,p_request_id text default null)
returns uuid language sql security definer set search_path = '' as $$
  select public.payment_apply_correction('correct_method',p_payment_id,p_new_method,null,null,p_reason,p_request_id);
$$;
create function public.payment_reassociate_transfer(p_payment_id uuid,p_new_sale_id uuid,p_applications jsonb,p_reason text,p_request_id text default null)
returns uuid language sql security definer set search_path = '' as $$
  select public.payment_apply_correction('reassociate_transfer',p_payment_id,null,p_new_sale_id,p_applications,p_reason,p_request_id);
$$;
revoke all on function public.payment_correction_guard_update(),
  public.payment_correction_commission(uuid),
  public.payment_apply_correction(text,uuid,text,uuid,jsonb,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.payment_annul(uuid,text,text),
  public.payment_correct_method(uuid,text,text,text),
  public.payment_reassociate_transfer(uuid,uuid,jsonb,text,text) from public,anon,service_role;
grant execute on function public.payment_annul(uuid,text,text),
  public.payment_correct_method(uuid,text,text,text),
  public.payment_reassociate_transfer(uuid,uuid,jsonb,text,text) to authenticated;
