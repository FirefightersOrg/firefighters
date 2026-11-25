-- SAN-107 + SAN-108 (Proposal A): reference entries at settlement close, balances that ignore them,
-- method corrections that keep them reconciled, and compensations linked to the entry they offset.
begin;
set local time zone 'America/Argentina/Buenos_Aires';
select plan(37);

insert into auth.users(id, email) values ('a6610000-0000-0000-0000-000000000001', 'admin661@example.com');
insert into public.profiles(id, auth_user_id, full_name, email, status)
values ('b6610000-0000-0000-0000-000000000001', 'a6610000-0000-0000-0000-000000000001', 'Admin 661', 'admin661@example.com', 'active');
insert into public.user_roles(user_id, role_id) select 'b6610000-0000-0000-0000-000000000001', id from public.roles where name = 'admin';
select set_config('request.jwt.claims', '{"sub":"a6610000-0000-0000-0000-000000000001","role":"authenticated"}', true);

create temp table ids(k text primary key, id uuid);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where k = $1 $$;

with x as (insert into public.campaigns(name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('SAN107', 100, 1, 100, 'base_number') returning id) insert into ids select 'campaign', id from x;
with x as (insert into public.collectors(display_name) values ('SAN107 collector') returning id) insert into ids select 'collector', id from x;
with x as (insert into public.collectors(display_name) values ('SAN107 other') returning id) insert into ids select 'other', id from x;
with x as (insert into public.buyers(type, first_name) values ('individual', 'SAN107 buyer') returning id) insert into ids select 'buyer', id from x;
insert into public.commission_rules(campaign_id, rule_type, percentage, valid_from)
values (pg_temp.id('campaign'), 'cash_full_payment', 10, current_date - 10);

-- Four full-payment sales of 100: two paid in cash, two by transfer, in one settlement.
do $$
declare k text; b uuid; s uuid; pp uuid; i uuid;
begin
  foreach k in array array['cash1', 'cash2', 'tr1', 'tr2'] loop
    insert into public.bonds(campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
    values (pg_temp.id('campaign'), 'simple', 'printed', 1, 100, 'available') returning id into b;
    insert into public.sales(campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
    values (pg_temp.id('campaign'), b, pg_temp.id('buyer'), pg_temp.id('collector'), 'full_payment', 100,
      'b6610000-0000-0000-0000-000000000001') returning id into s;
    insert into public.payment_plans(sale_id, installment_count, total_amount) values (s, 1, 100) returning id into pp;
    insert into public.installments(payment_plan_id, installment_number, due_date, amount)
    values (pp, 1, current_date - 1, 100) returning id into i;
    insert into ids values (k || '_sale', s), (k || '_installment', i);
  end loop;
end $$;
insert into ids values ('settlement', public.settlement_open(pg_temp.id('campaign'), pg_temp.id('collector')));
do $$
declare k text;
begin
  foreach k in array array['cash1', 'cash2', 'tr1', 'tr2'] loop
    insert into ids values (k || '_payment', public.settlement_add_payment(pg_temp.id('settlement'), pg_temp.id(k || '_sale'), 100,
      case when k like 'cash%' then 'cash' else 'transfer' end,
      jsonb_build_array(jsonb_build_object('installment_id', pg_temp.id(k || '_installment'), 'amount_applied', 100)))) on conflict do nothing;
  end loop;
end $$;
select public.settlement_close(pg_temp.id('settlement'));

create function pg_temp.entry(t text) returns uuid language sql stable as $$
  select id from public.collector_ledger_entries
  where settlement_id = pg_temp.id('settlement') and entry_type = t order by created_at, id limit 1 $$;
-- Net of the reference entries of one kind (their annulments are attributed through original_entry_id).
create function pg_temp.memo(t text) returns numeric language sql stable as $$
  select coalesce(sum(case when e.direction = 'collector_credit' then e.amount else -e.amount end), 0)
  from public.collector_ledger_entries e
  left join public.collector_ledger_entries o on o.id = e.original_entry_id
  where e.settlement_id = pg_temp.id('settlement') and not e.affects_balance and e.status <> 'annulled'
    and coalesce(o.entry_type, e.entry_type) = t $$;

-- 1. Structure ----------------------------------------------------------------------------------
select has_column('public', 'collector_ledger_entries', 'affects_balance', 'ledger entries have affects_balance');
select has_column('public', 'collector_ledger_entries', 'original_entry_id', 'ledger entries have original_entry_id');
select ok(not has_function_privilege('authenticated', 'public.ledger_compensation_target(uuid,uuid,text,numeric)', 'execute')
  and not has_function_privilege('authenticated', 'public.collector_ledger_uncompensated(uuid)', 'execute'),
  'the compensation helpers are internal (no client can call them)');

-- 2. Close posts the reference entries, and no balance counts them -------------------------------
select results_eq($$select entry_type, direction, amount, affects_balance from public.collector_ledger_entries
                    where settlement_id = pg_temp.id('settlement') order by entry_type$$,
  $$values ('cash_settled'::text, 'collector_credit'::text, 200.00::numeric, false),
           ('commission_generated', 'collector_credit', 40.00, true),
           ('commission_settled', 'collector_debit', 20.00, true),
           ('transfer_received_by_firefighters', 'collector_credit', 200.00, false)$$,
  'close posts commission entries plus one cash and one transfer reference entry');
select is(public.collector_ledger_balance(pg_temp.id('campaign'), pg_temp.id('collector')), 20.00::numeric,
  'the balance is the commission only (40 generated - 20 retained); references add nothing');
select results_eq($$select entry_count::int, credit_total, debit_total, balance from public.report_collector_accounts(pg_temp.id('campaign'), pg_temp.id('collector'))$$,
  $$values (4, '40.00'::text, '20.00'::text, '20.00'::text)$$,
  'the account report counts the reference rows but leaves them out of the totals');
select is((select array_agg(running_balance order by occurred_at, id) filter (where not affects_balance)
           from public.collector_ledger_entries_with_balance(pg_temp.id('campaign'), pg_temp.id('collector'))),
  array[20.00, 20.00]::numeric[], 'the running balance does not move on reference rows');
select is((select running_balance::numeric from public.report_collector_ledger(pg_temp.id('campaign'), pg_temp.id('collector'))
           where not affects_balance order by occurred_on desc limit 1), 20.00::numeric,
  'the account detail report keeps the running balance on reference rows');
select throws_ok($$select public.commission_settle(pg_temp.id('campaign'), pg_temp.id('collector'), 21, 'settle')$$,
  '22023', 'amount cannot exceed current collector balance', 'reference entries do not inflate what can be settled');
select is((select pg_temp.memo('cash_settled')) || '/' || pg_temp.memo('transfer_received_by_firefighters'),
  (select total_cash || '/' || total_transfer from public.settlements where id = pg_temp.id('settlement')),
  'the reference entries add up to the settlement totals');

-- 3. Constraints ----------------------------------------------------------------------------------
select throws_ok($$insert into public.collector_ledger_entries(campaign_id, collector_id, entry_type, direction, amount, created_by)
  values (pg_temp.id('campaign'), pg_temp.id('collector'), 'cash_settled', 'collector_credit', 1, 'b6610000-0000-0000-0000-000000000001')$$,
  '23514', null, 'a cash reference entry cannot affect the balance');
select throws_ok($$insert into public.collector_ledger_entries(campaign_id, collector_id, entry_type, direction, amount, affects_balance, created_by)
  values (pg_temp.id('campaign'), pg_temp.id('collector'), 'adjustment_in_favor_of_collector', 'collector_credit', 1, false, 'b6610000-0000-0000-0000-000000000001')$$,
  '23514', null, 'an adjustment always affects the balance');
select throws_ok($$insert into public.collector_ledger_entries(campaign_id, collector_id, entry_type, direction, amount, affects_balance, created_by)
  values (pg_temp.id('campaign'), pg_temp.id('collector'), 'annulment', 'collector_debit', 1, false, 'b6610000-0000-0000-0000-000000000001')$$,
  '23514', 'a reference annulment must name the reference entry it compensates', 'a reference annulment needs its original');

-- 4. Method corrections on the closed settlement keep the references reconciled (SAN-110) --------
insert into ids values ('cash1_new', public.payment_correct_method(pg_temp.id('cash1_payment'), 'transfer', 'was a transfer', 'san107-m1'));
select results_eq($$select entry_type, direction, amount, affects_balance, original_entry_id = pg_temp.entry('cash_settled')
                    from public.collector_ledger_entries where payment_id = pg_temp.id('cash1_payment') and not affects_balance$$,
  $$values ('annulment'::text, 'collector_debit'::text, 100.00::numeric, false, true)$$,
  'cash -> transfer compensates 100 of the cash reference entry');
select results_eq($$select entry_type, direction, amount from public.collector_ledger_entries where payment_id = pg_temp.id('cash1_new') and not affects_balance$$,
  $$values ('transfer_received_by_firefighters'::text, 'collector_credit'::text, 100.00::numeric)$$,
  'and records a transfer reference entry for the new payment');
select is(pg_temp.memo('cash_settled') || '/' || pg_temp.memo('transfer_received_by_firefighters'),
  (select total_cash || '/' || total_transfer from public.settlements where id = pg_temp.id('settlement')),
  'the reference entries still add up to the corrected totals (100 / 300)');
select is((select status from public.collector_ledger_entries where id = pg_temp.entry('cash_settled')), 'recorded',
  'a partly compensated entry stays recorded');
insert into ids values ('cash2_new', public.payment_correct_method(pg_temp.id('cash2_payment'), 'transfer', 'also a transfer', 'san107-m2'));
select is((select status from public.collector_ledger_entries where id = pg_temp.entry('cash_settled')), 'compensated',
  'a fully compensated reference entry becomes compensated');
select is(pg_temp.memo('cash_settled') || '/' || pg_temp.memo('transfer_received_by_firefighters'),
  (select total_cash || '/' || total_transfer from public.settlements where id = pg_temp.id('settlement')),
  'a compensated entry keeps counting, offset by its compensations (0 / 400)');
select ok((select bool_and(e.id is not null) from public.audit_log a
           cross join lateral jsonb_array_elements_text(a.new_value -> 'generated_compensatory_movements') m(id)
           left join public.collector_ledger_entries e on e.id = m.id::uuid and not e.affects_balance
           where a.request_id = 'san107-m1' and m.id::uuid in (select id from public.collector_ledger_entries where not affects_balance)),
  'the correction audit lists the reference movements it generated');

-- 5. Payment and settlement corrections reference the commission entry they offset (SAN-109) -----
select public.payment_annul(pg_temp.id('tr1_payment'), 'not received', 'san107-a1');
select results_eq($$select direction, amount, original_entry_id = pg_temp.entry('commission_generated')
                    from public.collector_ledger_entries where payment_id = pg_temp.id('tr1_payment') and affects_balance$$,
  $$values ('collector_debit'::text, 10.00::numeric, true)$$,
  'annulling a confirmed payment compensates its commission against the settlement''s commission_generated');
select public.settlement_correct(pg_temp.id('settlement'), 'commission was lower',
  '{"commission_delta": -5, "cash_retained_delta": 0}'::jsonb, 'san107-c1');
select is((select original_entry_id from public.collector_ledger_entries
           where settlement_id = pg_temp.id('settlement') and entry_type = 'annulment' and amount = 5 and affects_balance),
  pg_temp.entry('commission_generated'), 'a closed-settlement commission reduction references commission_generated');
select is(public.collector_ledger_uncompensated(pg_temp.entry('commission_generated')), 25.00::numeric,
  'what is left of commission_generated after both compensations (40 - 10 - 5)');

-- 6. Manual compensations (SAN-108) ----------------------------------------------------------------
insert into ids values ('x', public.collector_ledger_adjust(pg_temp.id('campaign'), pg_temp.id('collector'), 30, 'collector_credit', 'Bonus', 'san107-x'));
insert into ids values ('x1', public.collector_ledger_adjust(pg_temp.id('campaign'), pg_temp.id('collector'), 10, 'collector_debit', 'Bonus was 20', 'san107-x1', pg_temp.id('x')));
select is((select status || ':' || public.collector_ledger_uncompensated(id) from public.collector_ledger_entries where id = pg_temp.id('x')),
  'recorded:20.00', 'a partial compensation keeps the original recorded and lowers what is left');
select is((select original_entry_id from public.collector_ledger_entries where id = pg_temp.id('x1')), pg_temp.id('x'),
  'the manual compensation stores its original entry');
select is((select new_value ->> 'original_entry_id' from public.audit_log where request_id = 'san107-x1'), pg_temp.id('x')::text,
  'the adjustment audit records the original entry');
select throws_ok($$select public.collector_ledger_adjust(pg_temp.id('campaign'), pg_temp.id('collector'), 25, 'collector_debit', 'Too much', null, pg_temp.id('x'))$$,
  '22023', 'the compensation exceeds what is left of the original entry', 'a compensation cannot exceed what is left');
select throws_ok($$select public.collector_ledger_adjust(pg_temp.id('campaign'), pg_temp.id('collector'), 5, 'collector_credit', 'Same way', null, pg_temp.id('x'))$$,
  '23514', null, 'a compensation must go the opposite way');
select throws_ok($$select public.collector_ledger_adjust(pg_temp.id('campaign'), pg_temp.id('other'), 5, 'collector_debit', 'Other collector', null, pg_temp.id('x'))$$,
  '23514', 'the compensated entry must belong to the same campaign and collector', 'a compensation stays within the collector');
select throws_ok($$select public.collector_ledger_adjust(pg_temp.id('campaign'), pg_temp.id('collector'), 5, 'collector_debit', 'Memo', null,
    (select id from public.collector_ledger_entries where payment_id = pg_temp.id('cash1_new') and not affects_balance))$$,
  '23514', null, 'a balance adjustment cannot compensate a reference entry');
select throws_ok($$select public.collector_ledger_annul_entry(pg_temp.id('x1'), 'undo')$$,
  '55000', null, 'a compensating entry cannot be annulled');
select throws_ok($$select public.collector_ledger_annul_entry(pg_temp.id('x'), 'undo')$$,
  '55000', null, 'an entry with compensations cannot be annulled');
select throws_ok($$update public.collector_ledger_entries set status = 'compensated' where id = pg_temp.id('x')$$,
  '23514', null, 'an entry cannot be marked compensated by hand');
select public.collector_ledger_adjust(pg_temp.id('campaign'), pg_temp.id('collector'), 20, 'collector_debit', 'Rest of the bonus', 'san107-x2', pg_temp.id('x'));
select is((select status from public.collector_ledger_entries where id = pg_temp.id('x')), 'compensated',
  'the last compensation marks the original compensated');

-- 7. Nothing left to compensate: the correction still goes through, without a reference (#130) ----
select public.collector_ledger_adjust(pg_temp.id('campaign'), pg_temp.id('collector'), 25, 'collector_debit',
  'Use up commission_generated', 'san107-z', pg_temp.entry('commission_generated'));
select is((select status from public.collector_ledger_entries where id = pg_temp.entry('commission_generated')), 'compensated',
  'commission_generated has nothing left (40 - 10 - 5 - 25)');
select lives_ok($$select public.payment_annul(pg_temp.id('tr2_payment'), 'not received either', 'san107-a2')$$,
  'a payment annulment is not blocked when its commission entry has nothing left to compensate');
select is((select string_agg(direction || ':' || amount || ':' || coalesce(original_entry_id::text, 'none'), ',')
           from public.collector_ledger_entries where payment_id = pg_temp.id('tr2_payment') and affects_balance),
  'collector_debit:10.00:none', 'its annulment entry is recorded without an original entry');

select * from finish();
rollback;
