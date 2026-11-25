-- Post-restoration reconciliation (SAN-90, docs/backup-operations.md).
--
-- Read-only: only SELECTs. Run it against the production database (before the incident, or from
-- the last good export) and against the restored database, then compare the outputs line by line.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -A -F $'\t' -f scripts/reconcile-backup.sql
--
-- Local check:
--   docker exec -i supabase_db_firefighters psql -U postgres -v ON_ERROR_STOP=1 -X -A -F $'\t' \
--     < scripts/reconcile-backup.sql
--
-- Sections 1-4b are totals per campaign (bonds, payments, settlements, collector balances).
-- Section 5 lists integrity checks that must return zero rows. Section 6 is pending (Phase 11).

\echo '== 1. bonds per campaign and commercial status (count, total_value)'
select campaign_id, commercial_status, count(*) as bonds, coalesce(sum(total_value), 0)::text as total_value
from public.bonds
group by campaign_id, commercial_status
order by campaign_id, commercial_status;

\echo '== 2. payments per campaign and status (count, amount)'
select campaign_id, status, count(*) as payments, coalesce(sum(amount), 0)::text as amount
from public.payments
group by campaign_id, status
order by campaign_id, status;

\echo '== 3. settlements per campaign and status (count, totals)'
select campaign_id, status, count(*) as settlements,
  coalesce(sum(total_cash), 0)::text as total_cash,
  coalesce(sum(total_transfer), 0)::text as total_transfer,
  coalesce(sum(total_amount), 0)::text as total_amount,
  coalesce(sum(commission_amount), 0)::text as commission_amount,
  coalesce(sum(commission_paid_amount), 0)::text as commission_paid_amount,
  coalesce(sum(net_to_firefighters), 0)::text as net_to_firefighters
from public.settlements
group by campaign_id, status
order by campaign_id, status;

\echo '== 4. collector balances per campaign (credits - debits; annulled and reference entries excluded, SAN-107)'
select campaign_id, collector_id, count(*) as entries,
  coalesce(sum(case when not affects_balance then 0 when direction = 'collector_credit' then amount else -amount end), 0)::text as balance
from public.collector_ledger_entries
where status <> 'annulled'
group by campaign_id, collector_id
order by campaign_id, collector_id;

\echo '== 4b. correction links and settlement corrections per campaign (SAN-114)'
select p.campaign_id, 'payments_replacing' as item, count(*)::text as value
from public.payments p
where p.replaces_payment_id is not null
group by p.campaign_id
union all
select campaign_id, 'ledger_entries_correcting_sale', count(*)::text
from public.collector_ledger_entries
where corrects_sale_id is not null
group by campaign_id
union all
select s.campaign_id, 'settlement_corrections', count(*)::text
from public.settlement_corrections sc
join public.settlements s on s.id = sc.settlement_id
group by s.campaign_id
union all
select s.campaign_id, 'commission_delta', coalesce(sum(sc.commission_delta), 0)::text
from public.settlement_corrections sc
join public.settlements s on s.id = sc.settlement_id
group by s.campaign_id
union all
select s.campaign_id, 'cash_retained_delta', coalesce(sum(sc.cash_retained_delta), 0)::text
from public.settlement_corrections sc
join public.settlements s on s.id = sc.settlement_id
group by s.campaign_id
order by 1, 2;

\echo '== 5a. integrity: bonds with a sale-side collector/buyer that no longer exists (expect 0 rows)'
select b.id as bond_id
from public.bonds b
left join public.collectors c on c.id = b.current_collector_id
left join public.buyers y on y.id = b.current_buyer_id
where (b.current_collector_id is not null and c.id is null)
   or (b.current_buyer_id is not null and y.id is null);

\echo '== 5b. integrity: payments whose settlement belongs to another collector (expect 0 rows)'
select p.id as payment_id, p.settlement_id
from public.payments p
join public.settlements s on s.id = p.settlement_id
where s.collector_id <> p.collector_id;

\echo '== 5c. integrity: payment applications exceeding the payment amount (expect 0 rows)'
select pi.payment_id, p.amount::text as payment_amount, sum(pi.amount_applied)::text as applied
from public.payment_installments pi
join public.payments p on p.id = pi.payment_id
group by pi.payment_id, p.amount
having sum(pi.amount_applied) > p.amount;

\echo '== 5d. integrity: number of audit_log rows per entity type (compare with the source)'
select entity_type, count(*) as rows
from public.audit_log
group by entity_type
order by entity_type;

\echo '== 6. frozen rosters: entries per frozen roster (compare with the source; one frozen roster per draw)'
select d.campaign_id, d.id as draw_id, r.id as roster_id, r.frozen_at, count(e.id) as entries
from public.draw_rosters r
join public.draws d on d.id = r.draw_id
left join public.draw_roster_entries e on e.draw_roster_id = r.id
where r.status = 'frozen'
group by d.campaign_id, d.id, r.id, r.frozen_at
order by d.campaign_id, d.draw_date, d.id;

\echo '== 6b. winners and prizes: PENDING (Phase 12 tables do not exist yet; add the counts here)'
-- TODO(SAN-113): count winners and prizes per draw once the Phase 12 tables exist.
