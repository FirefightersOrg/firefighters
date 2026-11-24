-- SAN-111: settlement_close persists the collector balance at close (immutable afterwards),
-- historical closed settlements stay NULL, and payment_certificate_legend returns the legend data
-- only to payment.view holders.
begin;
select plan(17);
insert into auth.users(id,email) values
('a6500000-0000-0000-0000-000000000001','san111-treasurer@example.com'),
('a6500000-0000-0000-0000-000000000002','san111-reader@example.com'),
('a6500000-0000-0000-0000-000000000003','san111-admin@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status)
select ('b6500000-0000-0000-0000-00000000000'||n)::uuid,('a6500000-0000-0000-0000-00000000000'||n)::uuid,
  'SAN111 '||n,'san111-'||n||'@example.com','active' from generate_series(1,3)n;
insert into public.user_roles(user_id,role_id)
select ('b6500000-0000-0000-0000-00000000000'||n)::uuid,r.id
from (values(1,'treasurer'),(2,'read-only'),(3,'admin'))v(n,name) join public.roles r on r.name=v.name;
create temp table ids(k text primary key,id uuid not null);
insert into ids select k,gen_random_uuid() from unnest(array['c','collector','buyer','bond','sale','set','pay','hist'])k;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
create function pg_temp.act(n int) returns void language sql as $$
select set_config('request.jwt.claims',format('{"sub":"a6500000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
grant execute on function pg_temp.id(text),pg_temp.act(int) to authenticated;
grant select on ids to authenticated;
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode)
values(pg_temp.id('c'),'SAN111',100,1,100,'base_number');
insert into public.collectors(id,display_name) values(pg_temp.id('collector'),'SAN111 collector');
insert into public.buyers(id,type,first_name) values(pg_temp.id('buyer'),'individual','SAN111');
insert into public.bonds(id,campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
values(pg_temp.id('bond'),pg_temp.id('c'),'simple','printed',1,100,'available');
insert into public.sales(id,campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by)
values(pg_temp.id('sale'),pg_temp.id('c'),pg_temp.id('bond'),pg_temp.id('buyer'),pg_temp.id('collector'),
  'full_payment',100,'b6500000-0000-0000-0000-000000000001');
insert into public.settlements(id,campaign_id,settlement_number,collector_id,created_by)
values(pg_temp.id('set'),pg_temp.id('c'),1,pg_temp.id('collector'),'b6500000-0000-0000-0000-000000000001');
insert into public.payments(id,campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,status,created_by)
values(pg_temp.id('pay'),pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('collector'),pg_temp.id('buyer'),
  pg_temp.id('set'),100,'cash','pending_in_settlement','b6500000-0000-0000-0000-000000000001');

-- schema and grants
select has_column('public','settlements','collector_balance_at_close','snapshot column exists');
select ok(has_function_privilege('authenticated','public.payment_certificate_legend(uuid)','execute'),'authenticated may read legends');
select ok(not has_function_privilege('anon','public.payment_certificate_legend(uuid)','execute')
  and not has_function_privilege('service_role','public.payment_certificate_legend(uuid)','execute'),'anon and service_role may not');
select is((select provolatile::text||prosecdef::text from pg_proc where oid='public.payment_certificate_legend(uuid)'::regprocedure),
  'strue','legend RPC is stable security definer');

-- open settlements carry no snapshot
select is((select collector_balance_at_close from public.settlements where id=pg_temp.id('set')),null,'open settlement has no snapshot');
select throws_ok($$update public.settlements set collector_balance_at_close=1 where id=pg_temp.id('set')$$,'23514',null,
  'an open settlement cannot get a snapshot');

-- close through the RPC: the snapshot equals the computed balance at that instant
select pg_temp.act(1);
set local role authenticated;
create temp table before_close as select (public.settlement_totals(pg_temp.id('set'))).collector_credit_balance as balance;
select lives_ok($$select public.settlement_close(pg_temp.id('set'),'050-close')$$,'treasurer closes the settlement');
reset role;
select is((select collector_balance_at_close from public.settlements where id=pg_temp.id('set')),
  (select balance::numeric(12,2) from before_close),'snapshot equals the balance computed at close');
select isnt((select collector_balance_at_close from public.settlements where id=pg_temp.id('set')),null,'closed settlement has a snapshot');

-- immutable afterwards, even for privileged sessions
select throws_ok($$update public.settlements set collector_balance_at_close=collector_balance_at_close+1 where id=pg_temp.id('set')$$,
  '23001',null,'snapshot is immutable once closed');

-- historical closed settlements (closed before this migration) stay NULL: simulate one
alter table public.settlements disable trigger settlements_guard_update;
insert into public.settlements(id,campaign_id,settlement_number,collector_id,created_by)
values(pg_temp.id('hist'),pg_temp.id('c'),2,pg_temp.id('collector'),'b6500000-0000-0000-0000-000000000001');
update public.settlements set status='closed',closed_at=now(),closed_by='b6500000-0000-0000-0000-000000000001'
  where id=pg_temp.id('hist');
alter table public.settlements enable trigger settlements_guard_update;
select is((select collector_balance_at_close from public.settlements where id=pg_temp.id('hist')),null,
  'a historical closed settlement keeps a NULL snapshot (never backfilled with a live balance)');

-- legends: confirmed payment has none; annulled payment returns actor/date/reason; read-only denied
select pg_temp.act(1);
set local role authenticated;
select is((select count(*)::int from public.payment_certificate_legend(pg_temp.id('pay'))),0,'confirmed payment has no legend');
reset role;
-- Annulment fields as payment_annul (SAN-71) writes them; the RPC itself is covered by 033.
alter table public.payments disable trigger payments_guard_update;
alter table public.payments disable trigger payment_correction_guard_update;
update public.payments set status='annulled',annulled_at=now(),annulled_by='b6500000-0000-0000-0000-000000000003',
  annulment_reason='Wrong receipt' where id=pg_temp.id('pay');
alter table public.payments enable trigger payments_guard_update;
alter table public.payments enable trigger payment_correction_guard_update;
set local role authenticated;
-- Without payment_annul's audit row (correction_type) it is a removed pending payment: no legend.
select is((select count(*)::int from public.payment_certificate_legend(pg_temp.id('pay'))),0,
  'an annulled payment that was never confirmed (removed pending) has no certificate legend');
reset role;
insert into public.audit_log(actor_user_id,action,entity_type,entity_id,new_value,reason,request_id)
values('b6500000-0000-0000-0000-000000000003','payment.annul','payment',pg_temp.id('pay')::text,
  '{"correction_type":"annul"}','Wrong receipt','050-annul');
set local role authenticated;
select is((select legend_kind||'|'||coalesce(actor_name,'')||'|'||reason from public.payment_certificate_legend(pg_temp.id('pay'))),
  'annulled|SAN111 3|Wrong receipt','annulled legend with the annulling user name (not readable via profiles) and reason');
select is((select count(*)::int from public.payment_certificate_legend(gen_random_uuid())),0,'missing payment has no legend');
select pg_temp.act(2);
select throws_ok($$select * from public.payment_certificate_legend(pg_temp.id('pay'))$$,'42501',null,'read-only lacks payment.view');
select is((select count(*)::int from public.profiles where id='b6500000-0000-0000-0000-000000000003'),0,
  'the legend RPC does not open profiles');
select * from finish();
rollback;
