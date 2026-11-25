-- SAN-69: special per-collector rules, commission / ledger adjustments, entry annulment, ledger view.
begin;
select plan(42);
insert into auth.users(id,email) values
  ('a6320000-0000-0000-0000-000000000001','admin632@example.com'),
  ('a6320000-0000-0000-0000-000000000002','denied632@example.com'),
  ('a6320000-0000-0000-0000-000000000003','collector632@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status) values
  ('b6320000-0000-0000-0000-000000000001','a6320000-0000-0000-0000-000000000001','Admin','admin632@example.com','active'),
  ('b6320000-0000-0000-0000-000000000002','a6320000-0000-0000-0000-000000000002','Denied','denied632@example.com','active'),
  ('b6320000-0000-0000-0000-000000000003','a6320000-0000-0000-0000-000000000003','Collector','collector632@example.com','active');
insert into public.user_roles(user_id,role_id) select 'b6320000-0000-0000-0000-000000000001',id from public.roles where name='admin';
insert into public.user_roles(user_id,role_id) select 'b6320000-0000-0000-0000-000000000002',id from public.roles where name='read-only';
create temp table ids(k text primary key,id uuid); grant select,insert on ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
grant execute on function pg_temp.id(text) to authenticated;
create function pg_temp.act_as(n int) returns void language sql as
  $$select set_config('request.jwt.claims',format('{"sub":"a6320000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
grant execute on function pg_temp.act_as(int) to authenticated;
select pg_temp.act_as(1);
with x as (insert into public.campaigns(name,simple_bond_value,installment_count,installment_value,barcode_mode)
  values('SAN 69',100,2,50,'base_number') returning id) insert into ids select 'campaign',id from x;
insert into public.user_roles(user_id,role_id) select 'b6320000-0000-0000-0000-000000000003',id from public.roles where name='collector';
with x as (insert into public.collectors(display_name,user_profile_id) values('Ana','b6320000-0000-0000-0000-000000000003') returning id)
  insert into ids select 'collector',id from x;
with x as (insert into public.collectors(display_name) values('Other') returning id) insert into ids select 'other',id from x;
with x as (insert into public.collectors(display_name,status) values('Gone','inactive') returning id) insert into ids select 'inactive',id from x;

-- Structure.
select ok(exists(select 1 from pg_constraint where conname='commission_rules_applies_to_collector_fkey'),'special rules reference collectors');
select ok(to_regclass('public.commission_rules_applies_to_collector_idx') is not null,'special rule collector index');
select ok(not has_function_privilege('anon','public.commission_adjust(uuid,uuid,numeric,text,text,uuid,uuid,text)','execute')
  and has_function_privilege('authenticated','public.commission_adjust(uuid,uuid,numeric,text,text,uuid,uuid,text)','execute'),
  'commission_adjust granted to authenticated only');
select ok(has_function_privilege('authenticated','public.collector_ledger_entries_with_balance(uuid,uuid)','execute'),'ledger view granted');
-- Structural check only: this asserts lock presence, not execution or concurrency safety.
-- It does not prove the lock is reached on each branch; concurrent RPC execution is not tested here.
select ok(lower(pg_get_functiondef('public.collector_ledger_adjust(uuid,uuid,numeric,text,text,text)'::regprocedure)) like '%pg_advisory_xact_lock%'
  and lower(pg_get_functiondef('public.collector_ledger_annul_entry(uuid,text,text)'::regprocedure)) like '%pg_advisory_xact_lock%'
  and lower(pg_get_functiondef('public.commission_adjust(uuid,uuid,numeric,text,text,uuid,uuid,text)'::regprocedure)) like '%pg_advisory_xact_lock%',
  'structural: balance-lowering write definitions contain the SAN-68 ledger lock');

set local role authenticated;
-- Special rules through the audited create overload.
with x as (select public.commission_rule_create(pg_temp.id('campaign'),'installment_first',null,20,null,current_date,null,'r632-rule',null,pg_temp.id('collector')) id)
  insert into ids select 'special',id from x;
select is((select applies_to_collector_id from public.commission_rules where id=pg_temp.id('special')),pg_temp.id('collector'),'special rule stores its collector');
select is((select count(*)::int from public.audit_log where request_id='r632-rule' and action='commission_rule.create'),1,'special rule creation audited');
select throws_ok($$select public.commission_rule_create(pg_temp.id('campaign'),'installment_first',null,25,null,current_date,null,null,null,pg_temp.id('collector'))$$,
  '23P01',null,'overlapping active special rule for the same collector rejected');
select lives_ok($$select public.commission_rule_create(pg_temp.id('campaign'),'installment_first',null,25,null,current_date,null,null,null,pg_temp.id('other'))$$,
  'same rule for another collector is allowed');
select throws_ok($$select public.commission_rule_create(pg_temp.id('campaign'),'installment_last',null,5,null,current_date,null,null,null,pg_temp.id('inactive'))$$,
  '22023',null,'special rule for an inactive collector rejected');
select lives_ok($$select public.commission_rule_create(pg_temp.id('campaign'),'installment_first',null,10,null,current_date,null,null,null)$$,
  'legacy nine-argument general rule create still works');
reset role;
select is(public.settlement_application_commission(pg_temp.id('campaign'),pg_temp.id('collector'),current_date,'installments',1,2,50,50),
  10::numeric,'special 20% rule beats the general 10% rule (20% of 50)');
set local role authenticated;
select throws_ok($$update public.commission_rules set applies_to_collector_id=null where id=pg_temp.id('special')$$,
  '42501',null,'authenticated cannot update rules directly');

-- Commission adjustment (tier 3 difference).
with x as (select public.commission_adjust(pg_temp.id('campaign'),pg_temp.id('collector'),15,'in_favor_of_collector','Missed commission',null,null,'r632-adj') id)
  insert into ids select 'adj',id from x;
select is((select direction from public.commission_adjustments where id=pg_temp.id('adj')),'in_favor_of_collector','adjustment row recorded');
select is((select entry_type||'/'||direction||'/'||amount::text from public.collector_ledger_entries
  where campaign_id=pg_temp.id('campaign') and collector_id=pg_temp.id('collector') and entry_type like 'adjustment%'),
  'adjustment_in_favor_of_collector/collector_credit/15.00','adjustment creates the matching ledger credit');
select is((select percentage from public.commission_rules where id=pg_temp.id('special')),20::numeric,'adjustment never modifies the rule');
select is((select count(*)::int from public.audit_log where request_id='r632-adj' and action='commission.adjust'),1,'commission adjustment audited');
select throws_ok($$select public.commission_adjust(pg_temp.id('campaign'),pg_temp.id('collector'),5,'sideways','x')$$,'22023',null,'invalid direction rejected');
select throws_ok($$select public.commission_adjust(pg_temp.id('campaign'),pg_temp.id('collector'),5,'in_favor_of_collector','   ')$$,'22023',null,'blank reason rejected');
select throws_ok(format($$select public.commission_adjust(%L,%L,5,'in_favor_of_collector',%L)$$,pg_temp.id('campaign'),pg_temp.id('collector'),repeat('x',1001)),
  '22023',null,'reason over 1000 rejected');

-- Ledger adjustment and annulment.
with x as (select public.collector_ledger_adjust(pg_temp.id('campaign'),pg_temp.id('collector'),4,'collector_debit','Cash shortfall',null) id)
  insert into ids select 'debit',id from x;
select is((select entry_type from public.collector_ledger_entries where id=pg_temp.id('debit')),'adjustment_in_favor_of_firefighters','ledger debit maps to firefighters adjustment');
select is(public.collector_ledger_balance(pg_temp.id('campaign'),pg_temp.id('collector')),11::numeric,'balance = 15 credit - 4 debit');
select lives_ok($$select public.collector_ledger_annul_entry(pg_temp.id('debit'),'Entered twice')$$,'recorded entry can be annulled');
select is((select reason from public.collector_ledger_entries where id=pg_temp.id('debit')),'Cash shortfall','annulment preserves immutable original reason');
select is((select annul_reason from public.collector_ledger_entries where id=pg_temp.id('debit')),'Entered twice','annulment stores a separate annul reason');
select is((select old_value->>'reason' from public.audit_log where action='collector_ledger.annul' and entity_id=pg_temp.id('debit')::text),'Cash shortfall','annulment audit preserves original reason');
select is((select new_value->>'annul_reason' from public.audit_log where action='collector_ledger.annul' and entity_id=pg_temp.id('debit')::text),'Entered twice','annulment audit records annul reason');
select is(public.collector_ledger_balance(pg_temp.id('campaign'),pg_temp.id('collector')),15::numeric,'annulled entry leaves the balance');
select throws_ok($$select public.collector_ledger_annul_entry(pg_temp.id('debit'),'Again')$$,'55000',null,'only recorded entries can be annulled');
select is((select count(*)::int from public.audit_log where action in ('collector_ledger.adjust','collector_ledger.annul')),2,'ledger adjust and annul audited');

-- Ledger view with running balance.
select is((select running_balance from public.collector_ledger_entries_with_balance(pg_temp.id('campaign'),pg_temp.id('collector'))
  where id=pg_temp.id('debit')),15::numeric,'running balance skips annulled entries');
select is((select reason || '/' || annul_reason from public.collector_ledger_entries_with_balance(pg_temp.id('campaign'),pg_temp.id('collector'))
  where id=pg_temp.id('debit')),'Cash shortfall/Entered twice','ledger view returns both reasons');

-- Immutable commission adjustment history remains intact; the ledger list is the status source.
select lives_ok($$select public.collector_ledger_annul_entry((select id from public.collector_ledger_entries where reason='Missed commission'),'Wrong commission')$$,
  'commission adjustment ledger entry can be annulled');
select is((select status from public.collector_ledger_entries_with_balance(pg_temp.id('campaign'),pg_temp.id('collector'))
  where reason='Missed commission'),'annulled','commission adjustment list clearly exposes annulled status');

-- Inactive collectors must not strand existing special rules.
reset role;
update public.collectors set status='inactive' where id=pg_temp.id('collector');
set local role authenticated;
select lives_ok($$select public.commission_rule_update(pg_temp.id('special'),'installment_first',null,21,null,current_date,current_date,
  (select updated_at from public.commission_rules where id=pg_temp.id('special')))$$,
  'special rule for inactive collector can be edited and ended');
select lives_ok($$select public.commission_rule_annul(pg_temp.id('special'),'Collector retired')$$,
  'special rule for inactive collector can be annulled');

-- Same transaction timestamps, deliberately debit-first UUIDs: credit must win both sorts.
reset role;
insert into public.collector_ledger_entries(id,campaign_id,collector_id,entry_type,direction,amount,created_by)
values
  ('00000000-0000-4000-8000-000000000001',pg_temp.id('campaign'),pg_temp.id('other'),'adjustment_in_favor_of_firefighters','collector_debit',9,'b6320000-0000-0000-0000-000000000001'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff',pg_temp.id('campaign'),pg_temp.id('other'),'adjustment_in_favor_of_collector','collector_credit',9,'b6320000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select array_agg(direction) from public.collector_ledger_entries_with_balance(pg_temp.id('campaign'),pg_temp.id('other'))),
  array['collector_credit','collector_debit']::text[],'timestamp ties return credits before debits regardless of UUID');
select is((select array_agg(running_balance) from public.collector_ledger_entries_with_balance(pg_temp.id('campaign'),pg_temp.id('other'))),
  array[9,0]::numeric[],'timestamp ties calculate credit-first running balances without a negative intermediate balance');

-- Permissions.
select pg_temp.act_as(2);
select throws_ok($$select public.commission_adjust(pg_temp.id('campaign'),pg_temp.id('collector'),1,'in_favor_of_collector','x')$$,'42501',null,'read-only cannot adjust commissions');
select throws_ok($$select public.collector_ledger_adjust(pg_temp.id('campaign'),pg_temp.id('collector'),1,'collector_credit','x')$$,'42501',null,'read-only cannot adjust the ledger');
select pg_temp.act_as(3);
select is((select count(*)::int from public.collector_ledger_entries_with_balance(pg_temp.id('campaign'),pg_temp.id('collector'))),2,'collector reads its own ledger view');
select throws_ok($$select * from public.collector_ledger_entries_with_balance(pg_temp.id('campaign'),pg_temp.id('other'))$$,'42501',null,'collector cannot read another ledger');

select * from finish(); rollback;
