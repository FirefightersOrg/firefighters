-- SAN-69: per-collector rules and audited current-account corrections.
-- Closed settlement rows are deliberately not annulled: docs/corrections.md requires a
-- compensating adjustment linked to the original settlement instead.

-- The applies_to_collector_id FK and index already exist (20261203000000_collectors_buyers.sql).

alter table public.commission_rules
  add constraint commission_rules_collector_no_overlap exclude using gist (
    campaign_id with =, rule_type with =, (coalesce(installment_number, 0)) with =,
    applies_to_collector_id with =, (daterange(valid_from, valid_to, '[]')) with &&
  ) where (applies_to_collector_id is not null and status = 'active');

create or replace function public.commission_rules_guard_write()
returns trigger language plpgsql set search_path = '' as $$
declare v_campaign public.campaigns;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.campaign_id is distinct from old.campaign_id
      or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then
      raise exception 'commission_rules.id, campaign_id, created_at and created_by cannot be changed'
        using errcode = 'restrict_violation';
    end if;
    if new.applies_to_collector_id is distinct from old.applies_to_collector_id then
      raise exception 'commission_rules.applies_to_collector_id cannot be changed'
        using errcode = 'restrict_violation';
    end if;
    if old.status = 'annulled' then raise exception 'commission rule % is annulled and cannot be changed', old.id using errcode = 'object_not_in_prerequisite_state'; end if;
  else
    if new.status is distinct from 'active' then raise exception 'new commission rules must start in active status (got %)', new.status using errcode = 'check_violation'; end if;
    new.created_at := now();
  end if;
  -- A missing collector is reported by the foreign key; an existing one must be active.
  if new.applies_to_collector_id is not null and exists (
    select 1 from public.collectors where id = new.applies_to_collector_id and status <> 'active'
  ) then raise exception 'collector must be active' using errcode = 'check_violation'; end if;
  select * into v_campaign from public.campaigns where id = new.campaign_id;
  if found and v_campaign.status not in ('draft','active') then raise exception 'commission rules can only be changed while the campaign is draft or active (status: %)', v_campaign.status using errcode = 'object_not_in_prerequisite_state'; end if;
  if found and new.installment_number is not null and new.installment_number > v_campaign.installment_count then raise exception 'installment number % exceeds the campaign installment count (%)', new.installment_number, v_campaign.installment_count using errcode = 'check_violation'; end if;
  new.updated_at := now(); return new;
end $$;

-- The old nine-argument API stays intact; this overload adds the special-rule target.
create function public.commission_rule_create(
  p_campaign_id uuid, p_rule_type text, p_installment_number integer, p_percentage numeric,
  p_fixed_amount numeric, p_valid_from date, p_valid_to date, p_request_id text,
  p_reason text, p_applies_to_collector_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_campaign public.campaigns; v_rule public.commission_rules;
begin
  v_actor := public.commission_rule_require_actor();
  v_campaign := public.commission_rule_lock_campaign(p_campaign_id);
  perform public.commission_rule_validate(v_campaign,p_rule_type,p_installment_number,p_percentage,p_fixed_amount,p_valid_from,p_valid_to);
  if p_applies_to_collector_id is not null and not exists (select 1 from public.collectors where id=p_applies_to_collector_id and status='active') then
    raise exception 'collector must exist and be active' using errcode='invalid_parameter_value';
  end if;
  insert into public.commission_rules(campaign_id,rule_type,installment_number,percentage,fixed_amount,valid_from,valid_to,applies_to_collector_id,created_by)
  values(p_campaign_id,p_rule_type,p_installment_number,p_percentage,p_fixed_amount,p_valid_from,p_valid_to,p_applies_to_collector_id,v_actor) returning * into v_rule;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,reason,request_id)
  values(v_actor,'commission_rule.create','commission_rule',v_rule.id::text,null,public.commission_rule_audit_snapshot(v_rule),nullif(btrim(p_reason),''),p_request_id);
  return v_rule.id;
end $$;

create function public.commission_adjust(
  p_campaign_id uuid, p_collector_id uuid, p_amount numeric, p_direction text, p_reason text,
  p_settlement_id uuid default null, p_payment_id uuid default null, p_request_id text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.settlement_require_actor('commission.adjust'); v_reason text := nullif(btrim(p_reason),''); v_id uuid; v_entry uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN' or p_amount <> round(p_amount,2) then raise exception 'amount must be a positive amount with at most 2 decimal places' using errcode='invalid_parameter_value'; end if;
  if v_reason is null or length(v_reason)>1000 then raise exception 'a trimmed reason of at most 1000 characters is required' using errcode='invalid_parameter_value'; end if;
  if p_direction not in ('in_favor_of_collector','in_favor_of_firefighters') then raise exception 'invalid adjustment direction' using errcode='invalid_parameter_value'; end if;
  if not exists(select 1 from public.collectors where id=p_collector_id) then raise exception 'collector % not found',p_collector_id using errcode='no_data_found'; end if;
  if p_direction='in_favor_of_firefighters' then perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text || p_collector_id::text, 68)); end if;
  insert into public.commission_adjustments(campaign_id,collector_id,settlement_id,payment_id,amount,direction,reason,created_by)
  values(p_campaign_id,p_collector_id,p_settlement_id,p_payment_id,p_amount,p_direction,v_reason,v_actor) returning id into v_id;
  insert into public.collector_ledger_entries(campaign_id,collector_id,settlement_id,payment_id,entry_type,direction,amount,reason,created_by)
  values(p_campaign_id,p_collector_id,p_settlement_id,p_payment_id,'adjustment_'||p_direction,
    case when p_direction='in_favor_of_collector' then 'collector_credit' else 'collector_debit' end,p_amount,v_reason,v_actor) returning id into v_entry;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,new_value,reason,request_id)
  values(v_actor,'commission.adjust','commission_adjustment',v_id::text,jsonb_build_object('ledger_entry_id',v_entry,'campaign_id',p_campaign_id,'collector_id',p_collector_id,'amount',p_amount,'direction',p_direction),v_reason,p_request_id);
  return v_id;
end $$;

create function public.collector_ledger_adjust(
  p_campaign_id uuid,p_collector_id uuid,p_amount numeric,p_direction text,p_reason text,p_request_id text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.settlement_require_actor('collector.ledger.adjust'); v_reason text := nullif(btrim(p_reason),''); v_id uuid;
begin
  if p_amount is null or p_amount<=0 or p_amount='NaN' or p_amount<>round(p_amount,2) then raise exception 'amount must be a positive amount with at most 2 decimal places' using errcode='invalid_parameter_value'; end if;
  if v_reason is null or length(v_reason)>1000 then raise exception 'a trimmed reason of at most 1000 characters is required' using errcode='invalid_parameter_value'; end if;
  if p_direction not in ('collector_credit','collector_debit') then raise exception 'invalid ledger direction' using errcode='invalid_parameter_value'; end if;
  if not exists(select 1 from public.collectors where id=p_collector_id) then raise exception 'collector % not found',p_collector_id using errcode='no_data_found'; end if;
  if p_direction='collector_debit' then perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text || p_collector_id::text, 68)); end if;
  insert into public.collector_ledger_entries(campaign_id,collector_id,entry_type,direction,amount,reason,created_by)
  values(p_campaign_id,p_collector_id,case when p_direction='collector_credit' then 'adjustment_in_favor_of_collector' else 'adjustment_in_favor_of_firefighters' end,p_direction,p_amount,v_reason,v_actor) returning id into v_id;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,new_value,reason,request_id)
  values(v_actor,'collector_ledger.adjust','collector_ledger_entry',v_id::text,jsonb_build_object('campaign_id',p_campaign_id,'collector_id',p_collector_id,'amount',p_amount,'direction',p_direction),v_reason,p_request_id);
  return v_id;
end $$;

create function public.collector_ledger_annul_entry(p_entry_id uuid,p_reason text,p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.settlement_require_actor('collector.ledger.adjust'); v_reason text := nullif(btrim(p_reason),''); v_old public.collector_ledger_entries;
begin
  if v_reason is null or length(v_reason)>1000 then raise exception 'a trimmed reason of at most 1000 characters is required' using errcode='invalid_parameter_value'; end if;
  select * into v_old from public.collector_ledger_entries where id=p_entry_id for update;
  if not found then raise exception 'ledger entry % not found',p_entry_id using errcode='no_data_found'; end if;
  if v_old.status <> 'recorded' then raise exception 'only recorded ledger entries can be annulled' using errcode='object_not_in_prerequisite_state'; end if;
  if v_old.settlement_id is not null and exists(select 1 from public.settlements where id=v_old.settlement_id and status='closed') then raise exception 'closed-settlement entries must be corrected with a compensating adjustment' using errcode='object_not_in_prerequisite_state'; end if;
  if v_old.direction='collector_credit' then perform pg_advisory_xact_lock(hashtextextended(v_old.campaign_id::text || v_old.collector_id::text, 68)); end if;
  update public.collector_ledger_entries set status='annulled',annulled_by=v_actor,annulled_at=now(),reason=v_reason where id=p_entry_id;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,reason,request_id)
  values(v_actor,'collector_ledger.annul','collector_ledger_entry',p_entry_id::text,jsonb_build_object('status','recorded'),jsonb_build_object('status','annulled'),v_reason,p_request_id);
end $$;

create function public.collector_ledger_entries_with_balance(p_campaign_id uuid,p_collector_id uuid)
returns table(id uuid,occurred_at timestamptz,entry_type text,direction text,amount numeric,status text,settlement_id uuid,payment_id uuid,reason text,running_balance numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
 if not (public.collector_ledger_can_read() or public.collector_ledger_is_own_collector(p_collector_id)) then raise exception 'permission denied: collector ledger access is required' using errcode='insufficient_privilege'; end if;
 return query select e.id,e.occurred_at,e.entry_type,e.direction,e.amount,e.status,e.settlement_id,e.payment_id,e.reason,
   sum(case when e.status='annulled' then 0 when e.direction='collector_credit' then e.amount else -e.amount end) over(order by e.occurred_at,e.created_at,e.id)
 from public.collector_ledger_entries e where e.campaign_id=p_campaign_id and e.collector_id=p_collector_id order by e.occurred_at,e.created_at,e.id;
end $$;

revoke all on function public.commission_rule_create(uuid,text,integer,numeric,numeric,date,date,text,text,uuid),
 public.commission_adjust(uuid,uuid,numeric,text,text,uuid,uuid,text), public.collector_ledger_adjust(uuid,uuid,numeric,text,text,text),
 public.collector_ledger_annul_entry(uuid,text,text), public.collector_ledger_entries_with_balance(uuid,uuid) from public,anon,service_role;
grant execute on function public.commission_rule_create(uuid,text,integer,numeric,numeric,date,date,text,text,uuid),
 public.commission_adjust(uuid,uuid,numeric,text,text,uuid,uuid,text), public.collector_ledger_adjust(uuid,uuid,numeric,text,text,text),
 public.collector_ledger_annul_entry(uuid,text,text), public.collector_ledger_entries_with_balance(uuid,uuid) to authenticated;
