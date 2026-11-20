-- SAN-72. Historical payment parties and settlement totals remain snapshots.
create table public.settlement_corrections (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null unique references public.settlements(id) on delete restrict,
  commission_delta numeric(12,2) not null,
  cash_retained_delta numeric(12,2) not null,
  reason text not null check (reason=btrim(reason) and reason<>'' and char_length(reason)<=1000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (commission_delta<>'NaN' and cash_retained_delta<>'NaN'),
  check (commission_delta<>0 or cash_retained_delta<>0)
);
alter table public.settlement_corrections enable row level security;
revoke all on public.settlement_corrections from anon,authenticated,service_role;
grant select on public.settlement_corrections to authenticated;
create policy settlement_corrections_select on public.settlement_corrections
  for select to authenticated using (exists (
    select 1 from public.settlements s where s.id=settlement_id
  ));
create function public.settlement_corrections_guard_insert() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_setting('app.settlement_correction',true) is distinct from new.settlement_id::text
    or not exists(select 1 from public.settlements s where s.id=new.settlement_id and s.status='closed') then
    raise exception 'adjustments require the audited closed settlement correction'
      using errcode='check_violation';
  end if;
  return new;
end $$;
create trigger settlement_corrections_guard_insert before insert on public.settlement_corrections
  for each row execute function public.settlement_corrections_guard_insert();
create function public.settlement_corrections_check_original() returns trigger
language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.settlements s where s.id=new.settlement_id and s.status='corrected') then
    raise exception 'a linked adjustment must finish with a corrected settlement'
      using errcode='check_violation';
  end if;
  return null;
end $$;
create constraint trigger settlement_corrections_check_original after insert on public.settlement_corrections
  deferrable initially deferred for each row execute function public.settlement_corrections_check_original();
create trigger settlement_corrections_immutable before update on public.settlement_corrections
  for each row execute function public.commission_adjustments_forbid_update();
create trigger settlement_corrections_no_delete before delete on public.settlement_corrections
  for each row execute function public.commission_ledger_forbid_delete();
create trigger settlement_corrections_no_truncate before truncate on public.settlement_corrections
  for each statement execute function public.commission_ledger_forbid_delete();

-- New-collector compensation cannot claim an old collector's payment/settlement FK.
-- Keep those reference guards intact, and link both sides to the corrected sale instead.
alter table public.collector_ledger_entries add column corrects_sale_id uuid
  references public.sales(id) on delete restrict;
create index collector_ledger_corrects_sale_idx on public.collector_ledger_entries(corrects_sale_id);
create function public.sale_correction_ledger_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.status='annulled' and (old.corrects_sale_id is not null or exists (
      select 1 from public.settlements s where s.id=old.settlement_id and s.status='corrected'
    )) then
      raise exception 'correction entries require compensation, not annulment' using errcode='object_not_in_prerequisite_state';
    end if;
    if new.corrects_sale_id is distinct from old.corrects_sale_id then
      raise exception 'sale correction reference is immutable' using errcode='restrict_violation';
    end if;
  elsif new.corrects_sale_id is not null then
    if current_setting('app.sale_correction',true) is distinct from new.corrects_sale_id::text
      or new.entry_type<>'annulment' or not exists (
        select 1 from public.sales s where s.id=new.corrects_sale_id and s.campaign_id=new.campaign_id
      ) then
      raise exception 'sale compensation requires an audited correction' using errcode='check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger sale_correction_ledger_guard before insert or update on public.collector_ledger_entries
  for each row execute function public.sale_correction_ledger_guard();

create or replace function public.sales_guard_update() returns trigger
language plpgsql set search_path='' as $$
declare v_correction boolean := current_setting('app.sale_correction',true) is not distinct from old.id::text;
begin
  if (to_jsonb(new)-array['buyer_id','collector_id','updated_at','status'])
    is distinct from (to_jsonb(old)-array['buyer_id','collector_id','updated_at','status']) then
    raise exception 'sale identity is immutable' using errcode='restrict_violation';
  end if;
  if (new.buyer_id,new.collector_id) is distinct from (old.buyer_id,old.collector_id)
    and not (v_correction and old.status='active' and new.status='active') then
    raise exception 'sale parties require an audited correction' using errcode='restrict_violation';
  end if;
  if new.status is distinct from old.status
    and not (old.status='active' and new.status in ('annulled','corrected')) then
    raise exception 'invalid sale transition' using errcode='check_violation';
  end if;
  new.updated_at:=now(); return new;
end $$;

-- The existing bond guard permits party changes; narrow its sold-bond path explicitly.
create function public.sold_bond_correction_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.commercial_status='sold'
    and (new.current_buyer_id,new.current_collector_id) is distinct from
        (old.current_buyer_id,old.current_collector_id)
    and not exists (
      select 1 from public.sales s where s.bond_id=old.id and s.status='active'
        and s.id::text=current_setting('app.sale_correction',true)
        and s.buyer_id=new.current_buyer_id and s.collector_id=new.current_collector_id
    ) then
    raise exception 'sold bond parties require an audited sale correction' using errcode='restrict_violation';
  end if;
  return new;
end $$;
create trigger sold_bond_correction_guard before update on public.bonds
  for each row execute function public.sold_bond_correction_guard();

-- Closed -> corrected is permitted only with its immutable linked adjustment.
create function public.settlement_correction_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.status='corrected' then
    if new.status<>old.status then
      raise exception 'corrected settlements are terminal' using errcode='check_violation';
    end if;
    if (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
      raise exception 'corrected settlements are immutable' using errcode='restrict_violation';
    end if;
  end if;
  if old.status='closed' and new.status='corrected' and (
    current_setting('app.settlement_correction',true) is distinct from old.id::text
    or not exists(select 1 from public.settlement_corrections c where c.settlement_id=old.id)
    or (to_jsonb(new)-array['status','updated_at']) is distinct from
       (to_jsonb(old)-array['status','updated_at'])
  ) then
    raise exception 'closed settlement correction requires a linked audited adjustment' using errcode='restrict_violation';
  end if;
  return new;
end $$;
create trigger settlement_correction_guard before update on public.settlements
  for each row execute function public.settlement_correction_guard();

create function public.correction_audit(
  p_actor uuid,p_type text,p_entity text,p_id uuid,p_related jsonb,
  p_reason text,p_previous jsonb,p_next jsonb,p_movements jsonb,p_request_id text
) returns void language sql security definer set search_path='' as $$
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,reason,request_id)
  values(p_actor,p_entity||'.'||p_type,p_entity,p_id::text,p_previous,
    jsonb_build_object('correction_type',p_type,'affected_entity',jsonb_build_object('type',p_entity,'id',p_id),
      'related_entity',p_related,'reason',p_reason,'user',p_actor,'date',now(),
      'previous_value',p_previous,'new_value',p_next,'generated_compensatory_movements',p_movements),
    p_reason,p_request_id);
$$;

create function public.sale_apply_correction(
  p_sale_id uuid,p_target_id uuid,p_kind text,p_reason text,p_request_id text
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := public.settlement_require_actor('sale.correct');
  v_reason text := nullif(btrim(p_reason),'');
  v_old public.sales; v_new public.sales; v_note public.delivery_notes;
  v_payments uuid[]; v_current uuid[]; v_collector uuid;
  v_previous jsonb; v_next jsonb; v_movements jsonb := '[]';
  v_flag text := current_setting('app.sale_correction',true);
  v_amount numeric; v_commission numeric; v_id uuid; p record; r record;
begin
  if v_reason is null or char_length(v_reason)>1000 or p_target_id is null
    or p_kind is null or p_kind not in ('buyer','collector') then
    raise exception 'invalid correction or reason (1..1000 characters)' using errcode='invalid_parameter_value';
  end if;
  select * into v_old from public.sales where id=p_sale_id;
  if not found then raise exception 'sale not found' using errcode='no_data_found'; end if;
  -- Lock every existing campaign settlement: admission takes settlement then sale SHARE.
  -- New settlements can appear meanwhile; the payment-id recheck below refuses that race.
  -- NO KEY UPDATE still serializes state changes/admission, but permits FK KEY SHARE
  -- from existing manual ledger services (which may already hold a ledger lock).
  -- A collector correction may move commission between collectors, so it serializes against
  -- every settlement of the campaign. A buyer correction touches no payment or ledger row:
  -- it only locks the settlements of this sale's own payments (review of #72).
  if p_kind='collector' then
    perform id from public.settlements where campaign_id=v_old.campaign_id order by id for no key update;
  else
    perform s.id from public.settlements s
    where s.id in (select pay.settlement_id from public.payments pay where pay.sale_id=p_sale_id)
    order by s.id for no key update;
  end if;
  select coalesce(array_agg(id order by id),'{}') into v_payments from public.payments where sale_id=p_sale_id;
  perform id from public.payments where id=any(v_payments) order by id for no key update;
  select * into v_old from public.sales where id=p_sale_id for update;
  select coalesce(array_agg(id order by id),'{}') into v_current from public.payments where sale_id=p_sale_id;
  if v_current is distinct from v_payments then
    raise exception 'sale payments changed; reload and retry' using errcode='object_not_in_prerequisite_state';
  end if;
  if v_old.status<>'active' then raise exception 'sale must be active' using errcode='object_not_in_prerequisite_state'; end if;
  perform i.id from public.installments i join public.payment_plans pp on pp.id=i.payment_plan_id
    where pp.sale_id=p_sale_id order by i.id for update of i;
  if p_kind='buyer' then
    perform 1 from public.buyers where id=p_target_id for share;
    if not found then raise exception 'buyer not found' using errcode='no_data_found'; end if;
    if v_old.buyer_id=p_target_id then raise exception 'buyer must differ' using errcode='invalid_parameter_value'; end if;
  else
    perform public.delivery_require_collector(p_target_id);
    if v_old.collector_id=p_target_id then raise exception 'collector must differ' using errcode='invalid_parameter_value'; end if;
    if exists(select 1 from public.payments pay join public.settlements s on s.id=pay.settlement_id
      where pay.sale_id=p_sale_id and s.status='open' and pay.status not in ('annulled','adjusted')) then
      raise exception 'remove payments from open settlements before correcting the collector' using errcode='object_not_in_prerequisite_state';
    end if;
    -- Draft payments are immutable historical parties too; remove/correct them first.
    if exists(select 1 from public.payments where sale_id=p_sale_id and status='draft') then
      raise exception 'resolve draft payments before correcting the collector' using errcode='object_not_in_prerequisite_state';
    end if;
    for v_collector in select distinct c from unnest(array[v_old.collector_id,p_target_id]) c order by c loop
      perform pg_advisory_xact_lock(hashtextextended(v_old.campaign_id::text||v_collector::text,68));
    end loop;
  end if;
  perform 1 from public.bonds where id=v_old.bond_id for update;
  if not exists(select 1 from public.bonds where id=v_old.bond_id and commercial_status='sold') then
    raise exception 'sale bond must be sold' using errcode='object_not_in_prerequisite_state';
  end if;
  v_previous:=jsonb_build_object('sale',to_jsonb(v_old),'buyer',(
    select to_jsonb(b) from public.buyers b where id=v_old.buyer_id));
  perform set_config('app.sale_correction',p_sale_id::text,true);
  if p_kind='collector' then
    for p in select * from public.payments where sale_id=p_sale_id and status='confirmed' order by id loop
      -- SAN-71 helper supplies original attribution on the first move; subsequent moves
      -- use the sale's current collector, not the immutable payment collector.
      if p.collector_id=v_old.collector_id then
        v_commission:=public.payment_correction_commission(p.id);
      else
        select coalesce(sum(public.settlement_application_commission(p.campaign_id,v_old.collector_id,
          p.payment_date,v_old.payment_mode,i.installment_number,pp.installment_count,pi.amount_applied,i.amount)),0)
          into v_commission from public.payment_installments pi join public.installments i on i.id=pi.installment_id
          join public.payment_plans pp on pp.id=i.payment_plan_id where pi.payment_id=p.id;
      end if;
      select coalesce(sum(public.settlement_application_commission(p.campaign_id,p_target_id,
        p.payment_date,v_old.payment_mode,i.installment_number,pp.installment_count,pi.amount_applied,i.amount)),0)
        into v_amount from public.payment_installments pi join public.installments i on i.id=pi.installment_id
        join public.payment_plans pp on pp.id=i.payment_plan_id where pi.payment_id=p.id;
      for r in
        select v_old.collector_id collector,'collector_debit' direction,v_commission amount
        union all select v_old.collector_id,'collector_credit',v_commission where p.payment_method='cash'
        union all select p_target_id,'collector_credit',v_amount
        union all select p_target_id,'collector_debit',v_amount where p.payment_method='cash'
      loop
        if r.amount>0 then
          insert into public.collector_ledger_entries(campaign_id,collector_id,corrects_sale_id,entry_type,direction,amount,reason,created_by)
            values(v_old.campaign_id,r.collector,p_sale_id,'annulment',r.direction,r.amount,v_reason,v_actor) returning id into v_id;
          v_movements:=v_movements||jsonb_build_array(v_id);
        end if;
      end loop;
    end loop;
    v_note:=public.delivery_issue_note(v_old.campaign_id,p_target_id,v_actor,v_reason,'reassignment');
    update public.bond_assignments set status='reassigned' where bond_id=v_old.bond_id and status='active';
    insert into public.delivery_note_items(delivery_note_id,bond_id,campaign_id)
      values(v_note.id,v_old.bond_id,v_old.campaign_id);
    insert into public.bond_assignments(campaign_id,bond_id,collector_id,assignment_type,status,created_by,delivery_note_id)
      values(v_old.campaign_id,v_old.bond_id,p_target_id,'reassignment','active',v_actor,v_note.id);
  end if;
  update public.sales set buyer_id=case when p_kind='buyer' then p_target_id else buyer_id end,
    collector_id=case when p_kind='collector' then p_target_id else collector_id end
    where id=p_sale_id returning * into v_new;
  update public.bonds set current_buyer_id=v_new.buyer_id,current_collector_id=v_new.collector_id where id=v_old.bond_id;
  v_next:=jsonb_build_object('sale',to_jsonb(v_new),'buyer',(
    select to_jsonb(b) from public.buyers b where id=v_new.buyer_id),'delivery_note_id',v_note.id);
  perform public.correction_audit(v_actor,'correct_'||p_kind,'sale',p_sale_id,
    jsonb_build_object('type','bond','id',v_old.bond_id),v_reason,v_previous,v_next,v_movements,p_request_id);
  perform set_config('app.sale_correction',coalesce(v_flag,''),true);
end $$;

create function public.sale_correct_buyer(p_sale_id uuid,p_new_buyer_id uuid,p_reason text,p_request_id text default null)
returns void language sql security definer set search_path='' as $$
  select public.sale_apply_correction(p_sale_id,p_new_buyer_id,'buyer',p_reason,p_request_id);
$$;
create function public.sale_correct_collector(p_sale_id uuid,p_new_collector_id uuid,p_reason text,p_request_id text default null)
returns void language sql security definer set search_path='' as $$
  select public.sale_apply_correction(p_sale_id,p_new_collector_id,'collector',p_reason,p_request_id);
$$;

create function public.bond_correct_collector(p_bond_id uuid,p_new_collector_id uuid,p_reason text,p_request_id text default null)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid; v_bond public.bonds; v_sale uuid; v_reason text:=nullif(btrim(p_reason),'');
  v_campaign public.campaigns; v_note public.delivery_notes;
begin
  -- Read without lock before discovering the parent sale (never bond -> settlement).
  select id into v_sale from public.sales where bond_id=p_bond_id and status='active';
  if found then
    perform public.sale_correct_collector(v_sale,p_new_collector_id,p_reason,p_request_id);
    return;
  end if;
  v_actor:=public.bond_require_actor('bond.assign');
  if v_reason is null or char_length(v_reason)>1000 then
    raise exception 'reason required (1..1000 characters)' using errcode='invalid_parameter_value';
  end if;
  select * into v_bond from public.bonds where id=p_bond_id;
  if not found then raise exception 'bond not found' using errcode='no_data_found'; end if;
  v_campaign:=public.bond_lock_campaign(v_bond.campaign_id);
  perform public.delivery_require_collector(p_new_collector_id);
  select * into v_bond from public.delivery_lock_bonds(v_bond.campaign_id,array[p_bond_id]);
  if v_campaign.status<>'active' or v_bond.commercial_status<>'delivered_to_collector' then
    raise exception 'bond must be unsold and delivered in an active campaign; reload if sold' using errcode='object_not_in_prerequisite_state';
  end if;
  if v_bond.current_collector_id=p_new_collector_id then
    raise exception 'collector must differ' using errcode='invalid_parameter_value';
  end if;
  -- Same delivery helpers and custody transitions as bond_reassign, one correction audit
  -- instead of the normal reassignment's two audits.
  v_note:=public.delivery_issue_note(v_bond.campaign_id,p_new_collector_id,v_actor,v_reason,'reassignment');
  update public.bond_assignments set status='reassigned' where bond_id=p_bond_id and status='active';
  update public.bonds set current_collector_id=p_new_collector_id where id=p_bond_id;
  insert into public.delivery_note_items(delivery_note_id,bond_id,campaign_id)
    values(v_note.id,p_bond_id,v_bond.campaign_id);
  insert into public.bond_assignments(campaign_id,bond_id,collector_id,assignment_type,status,created_by,delivery_note_id)
    values(v_bond.campaign_id,p_bond_id,p_new_collector_id,'reassignment','active',v_actor,v_note.id);
  perform public.correction_audit(v_actor,'correct_collector','bond',p_bond_id,
    jsonb_build_object('type','delivery_note','id',v_note.id),v_reason,to_jsonb(v_bond),
    jsonb_build_object('collector_id',p_new_collector_id,'delivery_note_id',v_note.id),'[]',p_request_id);
end $$;

create function public.settlement_correct(p_settlement_id uuid,p_reason text,
  p_adjustments jsonb default null,p_request_id text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=public.settlement_require_actor('settlement.correct');
  v_reason text:=nullif(btrim(p_reason),''); v_old public.settlements; v_new public.settlements;
  v_comm numeric; v_cash numeric; v_id uuid; v_result uuid; r record;
  v_movements jsonb:='[]'; v_flag text:=current_setting('app.settlement_correction',true);
begin
  if v_reason is null or char_length(v_reason)>1000 then
    raise exception 'reason required (1..1000 characters)' using errcode='invalid_parameter_value';
  end if;
  if p_adjustments is null or jsonb_typeof(p_adjustments)<>'object'
    or not (p_adjustments ?& array['commission_delta','cash_retained_delta'])
    or (p_adjustments-array['commission_delta','cash_retained_delta'])<>'{}'::jsonb then
    raise exception 'adjustments require commission_delta and cash_retained_delta only' using errcode='invalid_parameter_value';
  end if;
  begin
    v_comm:=(p_adjustments->>'commission_delta')::numeric;
    v_cash:=(p_adjustments->>'cash_retained_delta')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid adjustment amount' using errcode='invalid_parameter_value';
  end;
  if v_comm is null or v_cash is null or v_comm='NaN' or v_cash='NaN'
    or abs(v_comm)>=10000000000 or abs(v_cash)>=10000000000
    or v_comm<>round(v_comm,2) or v_cash<>round(v_cash,2) or (v_comm=0 and v_cash=0) then
    raise exception 'adjustments must be nonzero signed numeric(12,2) deltas' using errcode='invalid_parameter_value';
  end if;
  select * into v_old from public.settlements where id=p_settlement_id for no key update;
  if not found then raise exception 'settlement not found' using errcode='no_data_found'; end if;
  if v_old.status<>'closed' then raise exception 'only closed settlements can be corrected once' using errcode='object_not_in_prerequisite_state'; end if;
  if v_old.commission_amount+v_comm<0 or v_old.commission_paid_amount+v_cash<0
    or v_old.commission_paid_amount+v_cash>v_old.total_cash
    or v_old.commission_paid_amount+v_cash>v_old.commission_amount+v_comm then
    raise exception 'adjusted commission and cash retention are inconsistent' using errcode='invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_old.campaign_id::text||v_old.collector_id::text,68));
  perform set_config('app.settlement_correction',p_settlement_id::text,true);
  insert into public.settlement_corrections(settlement_id,commission_delta,cash_retained_delta,reason,created_by)
    values(p_settlement_id,v_comm,v_cash,v_reason,v_actor) returning id into v_result;
  for r in select v_comm delta union all select -v_cash loop
    if r.delta<>0 then
      insert into public.collector_ledger_entries(campaign_id,collector_id,settlement_id,entry_type,direction,amount,reason,created_by)
        values(v_old.campaign_id,v_old.collector_id,p_settlement_id,'annulment',
          case when r.delta>0 then 'collector_credit' else 'collector_debit' end,abs(r.delta),v_reason,v_actor) returning id into v_id;
      v_movements:=v_movements||jsonb_build_array(v_id);
    end if;
  end loop;
  update public.settlements set status='corrected' where id=p_settlement_id returning * into v_new;
  perform set_config('app.settlement_correction',coalesce(v_flag,''),true);
  perform public.correction_audit(v_actor,'correct','settlement',p_settlement_id,
    jsonb_build_object('type','settlement_correction','id',v_result),v_reason,to_jsonb(v_old),
    jsonb_build_object('settlement',to_jsonb(v_new),'adjustment',p_adjustments),v_movements,p_request_id);
  return v_result;
end $$;

-- SAN-71 cannot attribute later payment corrections to a moved collector; fail safely,
-- rather than silently debit the historical collector twice.
create function public.moved_payment_correction_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.status='confirmed' and new.status in ('annulled','adjusted') and exists(
    select 1 from public.sales s where s.id=old.sale_id and s.collector_id<>old.collector_id
  ) then
    raise exception 'This payment''s sale was moved to another collector. Correct the sale collector back before annulling or correcting this payment.'
      using errcode='object_not_in_prerequisite_state';
  end if;
  return new;
end $$;
create trigger moved_payment_correction_guard before update on public.payments
  for each row execute function public.moved_payment_correction_guard();

revoke all on function public.sale_correction_ledger_guard(),public.sold_bond_correction_guard(),
  public.settlement_corrections_guard_insert(),public.settlement_corrections_check_original(),
  public.settlement_correction_guard(),public.moved_payment_correction_guard(),
  public.correction_audit(uuid,text,text,uuid,jsonb,text,jsonb,jsonb,jsonb,text),
  public.sale_apply_correction(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.sale_correct_buyer(uuid,uuid,text,text),
  public.sale_correct_collector(uuid,uuid,text,text),public.bond_correct_collector(uuid,uuid,text,text),
  public.settlement_correct(uuid,text,jsonb,text) from public,anon,service_role;
grant execute on function public.sale_correct_buyer(uuid,uuid,text,text),
  public.sale_correct_collector(uuid,uuid,text,text),public.bond_correct_collector(uuid,uuid,text,text),
  public.settlement_correct(uuid,text,jsonb,text) to authenticated;
revoke insert,update,delete,truncate on public.sales,public.settlements,public.payments,
  public.collector_ledger_entries from anon,authenticated,service_role;
