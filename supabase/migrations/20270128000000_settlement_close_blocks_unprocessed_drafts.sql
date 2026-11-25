-- SAN-156: settlement_close is blocked while the collector has unprocessed collector-submitted drafts in the campaign.
-- Replaces the 20270113 definition verbatim plus the check; grants are preserved by CREATE OR REPLACE.
-- Error: errcode FF156 (custom), message 'settlement has N unprocessed collector payments', detail = N.

CREATE OR REPLACE FUNCTION public.settlement_close(p_settlement_id uuid, p_request_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.settlement_require_actor('settlement.close');
  v_set public.settlements;
  v_tot record;
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  r record;
  v_unprocessed bigint;
begin
  select * into v_set from public.settlements where id = p_settlement_id for update;
  if not found then raise exception 'settlement % not found', p_settlement_id using errcode = 'no_data_found'; end if;
  if v_set.status <> 'open' then raise exception 'settlement must be open' using errcode = 'object_not_in_prerequisite_state'; end if;
  if not exists (select 1 from public.payments where settlement_id = p_settlement_id and status = 'pending_in_settlement') then
    raise exception 'settlement has no pending payments' using errcode = 'object_not_in_prerequisite_state';
  end if;
  perform p.id from public.payments p
    where p.settlement_id = p_settlement_id and p.status = 'pending_in_settlement'
    order by p.id for update;
  perform i.id from public.installments i
    join public.payment_installments pi on pi.installment_id = i.id
    join public.payments p on p.id = pi.payment_id
    where p.settlement_id = p_settlement_id order by i.id for update of i;
  perform pg_advisory_xact_lock(hashtextextended(v_set.campaign_id::text || v_set.collector_id::text, 68));
  -- SAN-156: a collector-submitted draft of THIS collector in THIS campaign blocks the close until the operator
  -- includes it in a settlement or rejects it. Other collectors/campaigns never block. The check runs after the
  -- settlement, payment and installment locks and the collector advisory lock (lock order unchanged). A draft that
  -- commits after this check is not lost or half-applied: it stays a draft (not part of this settlement) and
  -- blocks the collector's next close instead.
  select count(*) into v_unprocessed from public.payments p
    where p.campaign_id = v_set.campaign_id and p.collector_id = v_set.collector_id
      and p.status = 'draft' and p.submitted_by_collector;
  if v_unprocessed > 0 then
    raise exception 'settlement has % unprocessed collector payments', v_unprocessed
      using errcode = 'FF156', detail = v_unprocessed::text,
        hint = 'include each submitted payment in the settlement or reject it before closing';
  end if;
  select * into v_tot from public.settlement_totals(p_settlement_id);
  update public.payments set status = 'confirmed' where settlement_id = p_settlement_id and status = 'pending_in_settlement';
  for r in select distinct i.id, i.amount, i.due_date from public.installments i
    join public.payment_installments pi on pi.installment_id = i.id join public.payments p on p.id = pi.payment_id
    where p.settlement_id = p_settlement_id loop
    if (select coalesce(sum(pi.amount_applied), 0) from public.payment_installments pi
      join public.payments p on p.id = pi.payment_id where pi.installment_id = r.id and p.status = 'confirmed') >= r.amount then
      update public.installments set status = case when r.due_date > v_today then 'paid_advance' else 'paid' end
      where id = r.id and status in ('pending', 'overdue');
    end if;
  end loop;
  update public.bonds b set financial_status_snapshot = public.bond_financial_status_from_installments(b.id)
  where id in (select s.bond_id from public.sales s join public.payments p on p.sale_id = s.id
    where p.settlement_id = p_settlement_id and s.status = 'active');
  update public.settlements set total_cash = v_tot.total_cash, total_transfer = v_tot.total_transfer,
    total_amount = v_tot.total_amount, commission_amount = v_tot.commission_amount,
    commission_paid_amount = v_tot.commission_paid_amount, net_to_firefighters = v_tot.net_to_firefighters,
    collector_balance_at_close = v_tot.collector_credit_balance,
    status = 'closed', closed_at = now(), closed_by = v_actor where id = p_settlement_id;
  if v_tot.commission_amount > 0 then
    insert into public.collector_ledger_entries(campaign_id, collector_id, settlement_id, entry_type, direction, amount, created_by)
    values(v_set.campaign_id, v_set.collector_id, p_settlement_id, 'commission_generated', 'collector_credit', v_tot.commission_amount, v_actor);
  end if;
  if v_tot.commission_paid_amount > 0 then
    insert into public.collector_ledger_entries(campaign_id, collector_id, settlement_id, entry_type, direction, amount, created_by)
    values(v_set.campaign_id, v_set.collector_id, p_settlement_id, 'commission_settled', 'collector_debit', v_tot.commission_paid_amount, v_actor);
  end if;
  -- Reference entries: what the collector handed in and what reached Firefighters by transfer.
  if v_tot.total_cash > 0 then
    insert into public.collector_ledger_entries(campaign_id, collector_id, settlement_id, entry_type, direction, amount, affects_balance, created_by)
    values(v_set.campaign_id, v_set.collector_id, p_settlement_id, 'cash_settled', 'collector_credit', v_tot.total_cash, false, v_actor);
  end if;
  if v_tot.total_transfer > 0 then
    insert into public.collector_ledger_entries(campaign_id, collector_id, settlement_id, entry_type, direction, amount, affects_balance, created_by)
    values(v_set.campaign_id, v_set.collector_id, p_settlement_id, 'transfer_received_by_firefighters', 'collector_credit', v_tot.total_transfer, false, v_actor);
  end if;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'settlement.close', 'settlement', p_settlement_id::text,
    jsonb_build_object('status', 'closed', 'total_amount', v_tot.total_amount), p_request_id);
end $function$;

-- Dashboard (SAN-156): collector-submitted drafts waiting for the operator, per collector, with the collector's
-- oldest open settlement of the campaign (where the operator includes or rejects them). Same permission as the
-- other operational dashboard functions.
create function public.dashboard_submitted_payments(p_campaign_id uuid)
returns table (
  collector_id uuid, collector_name text, payment_count bigint, total_amount numeric, open_settlement_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.report_require_operational(p_campaign_id);
  return query
  select p.collector_id, c.display_name, count(*), sum(p.amount),
    (select s.id from public.settlements s
      where s.campaign_id = p_campaign_id and s.collector_id = p.collector_id and s.status = 'open'
      order by s.opened_at, s.id limit 1)
  from public.payments p
  join public.collectors c on c.id = p.collector_id
  where p.campaign_id = p_campaign_id and p.status = 'draft' and p.submitted_by_collector
  group by p.collector_id, c.display_name
  order by c.display_name, p.collector_id;
end $$;
revoke all on function public.dashboard_submitted_payments(uuid) from public, anon, service_role;
grant execute on function public.dashboard_submitted_payments(uuid) to authenticated;
