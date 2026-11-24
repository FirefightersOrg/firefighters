-- SAN-110: method corrections are the sole exception to frozen settlement totals.
-- This trigger runs on the replacement, after the original is adjusted and before
-- its audit. No additional lock is acquired: SAN-71 already holds settlement,
-- payment, sorted installments and the ledger advisory lock, in that order.
create function public.payment_method_settlement_totals() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  v_old public.payments;
  v_set public.settlements;
  v_comm numeric;
  v_sign integer;
  v_flag text:=current_setting('app.settlement_method_payment',true);
begin
  if new.replaces_payment_id is null then return new; end if;
  select * into v_old from public.payments where id=new.replaces_payment_id;
  if new.payment_method=v_old.payment_method then return new; end if;
  if current_setting('app.payment_correction',true) is distinct from v_old.id::text then
    raise exception 'method totals require an audited payment correction' using errcode='42501';
  end if;
  select * into v_set from public.settlements where id=new.settlement_id;
  if v_set.status not in ('closed','corrected') then return new; end if;
  v_comm:=public.payment_correction_commission(v_old.id);
  v_sign:=case when new.payment_method='cash' then 1 else -1 end;
  perform set_config('app.settlement_method_payment',new.id::text,true);
  update public.settlements set
    total_cash=total_cash+v_sign*new.amount,
    total_transfer=total_transfer-v_sign*new.amount,
    commission_paid_amount=commission_paid_amount+v_sign*v_comm,
    net_to_firefighters=net_to_firefighters-v_sign*v_comm
    where id=new.settlement_id;
  perform set_config('app.settlement_method_payment',coalesce(v_flag,''),true);
  return new;
end $$;
create trigger payment_method_settlement_totals after insert on public.payments
  for each row execute function public.payment_method_settlement_totals();

-- Validate the entire delta, not just a caller-set flag. API roles have no DML.
create function public.settlement_method_totals_allowed(
  p_old public.settlements,p_new public.settlements
) returns boolean language sql stable security definer set search_path='' as $$
  select p_old.status in ('closed','corrected')
    and (to_jsonb(p_old)-array['total_cash','total_transfer','commission_paid_amount','net_to_firefighters','updated_at'])
      = (to_jsonb(p_new)-array['total_cash','total_transfer','commission_paid_amount','net_to_firefighters','updated_at'])
    and exists (
      select 1 from public.payments n join public.payments o on o.id=n.replaces_payment_id
      cross join lateral (select case when n.payment_method='cash' then 1 else -1 end sign,
        public.payment_correction_commission(o.id) commission) c
      where n.id::text=current_setting('app.settlement_method_payment',true)
        and o.id::text=current_setting('app.payment_correction',true)
        and o.status='adjusted' and n.status='confirmed'
        and n.settlement_id=p_old.id and o.settlement_id=p_old.id
        and n.payment_method<>o.payment_method and n.amount=o.amount
        and p_new.total_cash=p_old.total_cash+c.sign*n.amount
        and p_new.total_transfer=p_old.total_transfer-c.sign*n.amount
        and p_new.commission_paid_amount=p_old.commission_paid_amount+c.sign*c.commission
        and p_new.net_to_firefighters=p_old.net_to_firefighters-c.sign*c.commission
    );
$$;

create or replace function public.settlements_guard_update() returns trigger
language plpgsql set search_path='' as $$
begin
  if public.settlement_method_totals_allowed(old,new) then
    -- Even updated_at stays frozen; the correction's audit carries its timestamp.
    new.updated_at:=old.updated_at;
    return new;
  end if;
  if (new.id,new.campaign_id,new.settlement_number,new.collector_id,new.opened_at,new.created_by)
    is distinct from (old.id,old.campaign_id,old.settlement_number,old.collector_id,old.opened_at,old.created_by) then
    raise exception 'settlement identity is immutable' using errcode='restrict_violation';
  end if;
  if new.status is distinct from old.status and not (
    (old.status='open' and new.status in ('closed','annulled')) or (old.status='closed' and new.status='corrected')
  ) then raise exception 'settlement status cannot go from % to %',old.status,new.status using errcode='check_violation'; end if;
  if old.status<>'open' and (new.total_cash,new.total_transfer,new.total_amount,new.commission_amount,
    new.commission_paid_amount,new.net_to_firefighters,new.notes) is distinct from
    (old.total_cash,old.total_transfer,old.total_amount,old.commission_amount,
    old.commission_paid_amount,old.net_to_firefighters,old.notes) then
    raise exception 'only open settlement totals can change' using errcode='restrict_violation';
  end if;
  if old.status<>'open' and (new.closed_at,new.closed_by) is distinct from (old.closed_at,old.closed_by) then
    raise exception 'closed settlement fields are immutable' using errcode='restrict_violation';
  end if;
  new.updated_at:=now(); return new;
end $$;

create or replace function public.settlement_correction_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if public.settlement_method_totals_allowed(old,new) then return new; end if;
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

-- Enrich the one existing correction audit at INSERT time; never rewrite audit
-- history. Reconstruct the before snapshot from the exact delta just applied.
create function public.payment_method_totals_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  v_payment public.payments;
  v_set public.settlements;
  v_before jsonb;
  v_sign integer;
  v_comm numeric;
begin
  if new.action<>'payment.correct_method' then return new; end if;
  select * into v_payment from public.payments
    where id=(new.new_value->'new_value'->'payment'->>'id')::uuid;
  select * into v_set from public.settlements where id=v_payment.settlement_id;
  if v_set.status not in ('closed','corrected') then return new; end if;
  v_sign:=case when v_payment.payment_method='cash' then 1 else -1 end;
  v_comm:=public.payment_correction_commission(v_payment.replaces_payment_id);
  v_before:=to_jsonb(v_set)||jsonb_build_object(
    'total_cash',v_set.total_cash-v_sign*v_payment.amount,
    'total_transfer',v_set.total_transfer+v_sign*v_payment.amount,
    'commission_paid_amount',v_set.commission_paid_amount-v_sign*v_comm,
    'net_to_firefighters',v_set.net_to_firefighters+v_sign*v_comm);
  new.old_value:=new.old_value||jsonb_build_object('settlement',v_before);
  new.new_value:=jsonb_set(new.new_value,'{previous_value}',new.old_value);
  new.new_value:=jsonb_set(new.new_value,'{new_value,settlement}',to_jsonb(v_set));
  return new;
end $$;
create trigger payment_method_totals_audit before insert on public.audit_log
  for each row execute function public.payment_method_totals_audit();

revoke all on function public.payment_method_settlement_totals(),
  public.settlement_method_totals_allowed(public.settlements,public.settlements),
  public.payment_method_totals_audit()
  from public,anon,authenticated,service_role;
