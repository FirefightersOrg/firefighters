-- SAN-154: "Mi cuenta corriente" shows the REASON of manual adjustments (product decision, issue #50 Q6).
--
-- portal_my_ledger gets one more column, `adjustment_reason`: the operator's `reason`, only for the two manual
-- adjustment types (adjustment_in_favor_of_collector / adjustment_in_favor_of_firefighters); null for every other
-- type (commissions, settlements, annulments and corrections). An annulled adjustment keeps its original reason.
-- `annul_reason`, the creator, the annulling user and any other internal note are still never returned.
-- portal_my_ledger_summary is unchanged (balances and totals do not change).
-- The result type changes, so the function is dropped and created again with its grants re-applied.

drop function public.portal_my_ledger(uuid, integer, integer);

create function public.portal_my_ledger(p_campaign_id uuid, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, occurred_at timestamptz, entry_type text, direction text, amount numeric, status text,
               settlement_id uuid, settlement_number integer, affects_balance boolean, running_balance numeric,
               total_count bigint, adjustment_reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_collector uuid;
  v_aff text := public.portal_ledger_affects_balance_expr();
begin
  if not public.has_permission('collector.ledger.view_own') then
    raise exception 'permission denied: collector.ledger.view_own is required' using errcode = 'insufficient_privilege';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 then
    raise exception 'invalid page: limit must be 1..100 and offset at least 0' using errcode = '22023';
  end if;
  if not exists (select 1 from public.campaigns c where c.id = p_campaign_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  select c.id into v_collector from public.collectors c
  where c.user_profile_id is not null and c.user_profile_id = public.current_profile_id();
  if v_collector is null then return; end if;
  -- Order key: the treasury key; within one instant the entries that affect the balance come first, then the id.
  return query execute format($q$
    with ordered as (
      select e.id, e.occurred_at, e.entry_type, e.direction, e.amount, e.status, e.settlement_id,
             case when e.entry_type in ('adjustment_in_favor_of_collector', 'adjustment_in_favor_of_firefighters')
                  then e.reason end as adjustment_reason,
             (%1$s) as affects_balance,
             sum(case when e.status = 'annulled' or not (%1$s) then 0
                      when e.direction = 'collector_credit' then e.amount else -e.amount end)
               over w as running_balance,
             row_number() over w as ord,
             count(*) over () as total_count
      from public.collector_ledger_entries e
      where e.campaign_id = $1 and e.collector_id = $2
      window w as (order by e.occurred_at, e.created_at, case when (%1$s) then 0 else 1 end,
                            case when e.direction = 'collector_credit' then 0 else 1 end, e.id)
    )
    select o.id, o.occurred_at, o.entry_type, o.direction, o.amount, o.status, o.settlement_id, s.settlement_number,
           o.affects_balance, o.running_balance, o.total_count, o.adjustment_reason
    from ordered o
    left join public.settlements s on s.id = o.settlement_id and s.collector_id = $2
    order by o.ord desc
    limit $3 offset $4
  $q$, v_aff) using p_campaign_id, v_collector, p_limit, p_offset;
end $$;

revoke all on function public.portal_my_ledger(uuid, integer, integer) from public, anon, service_role;
grant execute on function public.portal_my_ledger(uuid, integer, integer) to authenticated;
