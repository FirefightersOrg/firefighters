-- SAN-146: collector portal, "Mi cuenta corriente" (Phase 16). Read-only.
--
-- Two bounded read functions for the caller's OWN collector (resolved from the session, never from an argument):
--   portal_my_ledger_summary(campaign)           balance and commission totals (generated / adjusted / settled /
--                                                annulments and corrections / other movements); the lines add up
--                                                to the balance: generated + adjusted - settled + annulments + other
--   portal_my_ledger(campaign, limit, offset)    one page of entries, newest first, with the running balance
-- Both need `collector.ledger.view_own` (permission AND ownership), reuse the ordering of the treasury view
-- (`collector_ledger_entries_with_balance`) so balances match, and never return internal notes: no `reason`,
-- no `annul_reason`, no creator. Annulled entries are listed but add 0 to the balance and the totals.
-- The settlement history needs no function: `settlements_select` already limits the collector to its own rows
-- and the page selects bounded columns. A profile that is not linked to a collector gets no rows.
--
-- Reference entries (`collector_ledger_entries.affects_balance = false`, PR #130 / SAN-107): they are listed
-- (flagged through `affects_balance`) but never count in the balance. The column may not exist yet when this
-- migration is applied (#130 not merged), so the functions look for it at run time (pg_attribute) and build
-- their query with `affects_balance` only when it is there; without it every entry affects the balance.
-- The SQL text is fixed (no caller input is concatenated), so there is no injection surface.

create function public.portal_ledger_affects_balance_expr()
returns text language sql stable set search_path = '' as $$
  select case when exists (select 1 from pg_attribute
                           where attrelid = 'public.collector_ledger_entries'::regclass
                             and attname = 'affects_balance' and not attisdropped)
              then 'e.affects_balance' else 'true' end;
$$;
revoke all on function public.portal_ledger_affects_balance_expr() from public, anon, service_role, authenticated;

create function public.portal_my_ledger_summary(p_campaign_id uuid)
returns table (balance numeric, commission_generated numeric, commission_adjusted numeric,
               commission_settled numeric, commission_annulments numeric, other_movements numeric,
               entry_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_collector uuid;
  v_aff text := public.portal_ledger_affects_balance_expr();
begin
  if not public.has_permission('collector.ledger.view_own') then
    raise exception 'permission denied: collector.ledger.view_own is required' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.campaigns c where c.id = p_campaign_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  select c.id into v_collector from public.collectors c
  where c.user_profile_id is not null and c.user_profile_id = public.current_profile_id();
  if v_collector is null then return; end if;
  return query execute format($q$
    select coalesce(sum(case when e.status = 'annulled' or not %1$s then 0
                             when e.direction = 'collector_credit' then e.amount else -e.amount end), 0),
           coalesce(sum(e.amount) filter (where e.status <> 'annulled' and %1$s and e.entry_type = 'commission_generated'), 0),
           coalesce(sum(case when e.entry_type = 'adjustment_in_favor_of_collector' then e.amount
                             when e.entry_type = 'adjustment_in_favor_of_firefighters' then -e.amount else 0 end)
                    filter (where e.status <> 'annulled' and %1$s), 0),
           coalesce(sum(e.amount) filter (where e.status <> 'annulled' and %1$s and e.entry_type = 'commission_settled'), 0),
           -- annulment entries (payment annulments, method changes, sale and settlement corrections) carry their sign
           coalesce(sum(case when e.direction = 'collector_credit' then e.amount else -e.amount end)
                    filter (where e.status <> 'annulled' and %1$s and e.entry_type = 'annulment'), 0),
           -- any other entry type that moves the balance (cash settled, transfer received), signed
           coalesce(sum(case when e.direction = 'collector_credit' then e.amount else -e.amount end)
                    filter (where e.status <> 'annulled' and %1$s
                              and e.entry_type in ('cash_settled', 'transfer_received_by_firefighters')), 0),
           count(*)
    from public.collector_ledger_entries e
    where e.campaign_id = $1 and e.collector_id = $2
  $q$, v_aff) using p_campaign_id, v_collector;
end $$;

create function public.portal_my_ledger(p_campaign_id uuid, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, occurred_at timestamptz, entry_type text, direction text, amount numeric, status text,
               settlement_id uuid, settlement_number integer, affects_balance boolean, running_balance numeric,
               total_count bigint)
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
           o.affects_balance, o.running_balance, o.total_count
    from ordered o
    left join public.settlements s on s.id = o.settlement_id and s.collector_id = $2
    order by o.ord desc
    limit $3 offset $4
  $q$, v_aff) using p_campaign_id, v_collector, p_limit, p_offset;
end $$;

revoke all on function public.portal_my_ledger_summary(uuid), public.portal_my_ledger(uuid, integer, integer)
  from public, anon, service_role;
grant execute on function public.portal_my_ledger_summary(uuid), public.portal_my_ledger(uuid, integer, integer)
  to authenticated;
