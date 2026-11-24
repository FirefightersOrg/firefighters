-- SAN-122: document_actor_name returns only the registering user's name of one document, gated by
-- the document's print permission, without opening profiles to non-admin roles.
begin;
select plan(16);
insert into auth.users(id,email) values
('a6450000-0000-0000-0000-000000000001','san122-admin@example.com'),
('a6450000-0000-0000-0000-000000000002','san122-treasurer@example.com'),
('a6450000-0000-0000-0000-000000000003','san122-reader@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status)
select ('b6450000-0000-0000-0000-00000000000'||n)::uuid,('a6450000-0000-0000-0000-00000000000'||n)::uuid,
  'SAN122 '||n,'san122-'||n||'@example.com','active' from generate_series(1,3)n;
insert into public.user_roles(user_id,role_id)
select ('b6450000-0000-0000-0000-00000000000'||n)::uuid,r.id
from (values(1,'admin'),(2,'treasurer'),(3,'read-only'))v(n,name) join public.roles r on r.name=v.name;
create temp table ids(k text primary key,id uuid not null);
insert into ids select k,gen_random_uuid() from unnest(array['c','collector','buyer','bond','sale','set','pay','note','open'])k;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
create function pg_temp.act(n int) returns void language sql as $$
select set_config('request.jwt.claims',format('{"sub":"a6450000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
grant execute on function pg_temp.id(text),pg_temp.act(int) to authenticated;
grant select on ids to authenticated;
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode)
values(pg_temp.id('c'),'SAN122',100,1,100,'base_number');
insert into public.collectors(id,display_name) values(pg_temp.id('collector'),'SAN122 collector');
insert into public.buyers(id,type,first_name) values(pg_temp.id('buyer'),'individual','SAN122');
insert into public.bonds(id,campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
values(pg_temp.id('bond'),pg_temp.id('c'),'simple','printed',1,100,'available');
insert into public.sales(id,campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by)
values(pg_temp.id('sale'),pg_temp.id('c'),pg_temp.id('bond'),pg_temp.id('buyer'),pg_temp.id('collector'),
  'full_payment',100,'b6450000-0000-0000-0000-000000000001');
insert into public.settlements(id,campaign_id,settlement_number,collector_id,created_by)
values(pg_temp.id('set'),pg_temp.id('c'),1,pg_temp.id('collector'),'b6450000-0000-0000-0000-000000000001'),
      (pg_temp.id('open'),pg_temp.id('c'),2,pg_temp.id('collector'),'b6450000-0000-0000-0000-000000000001');
insert into public.payments(id,campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,status,created_by)
values(pg_temp.id('pay'),pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('collector'),pg_temp.id('buyer'),
  pg_temp.id('open'),100,'cash','pending_in_settlement','b6450000-0000-0000-0000-000000000001');
update public.settlements set status='closed',closed_at=now(),closed_by='b6450000-0000-0000-0000-000000000001' where id=pg_temp.id('set');
insert into public.delivery_notes(id,campaign_id,note_number,collector_id,created_by)
values(pg_temp.id('note'),pg_temp.id('c'),1,pg_temp.id('collector'),'b6450000-0000-0000-0000-000000000001');

select ok(has_function_privilege('authenticated','public.document_actor_name(text,uuid)','execute'),'authenticated may execute');
select ok(not has_function_privilege('anon','public.document_actor_name(text,uuid)','execute'),'anon may not execute');
select ok(not has_function_privilege('service_role','public.document_actor_name(text,uuid)','execute'),'service_role may not execute');
select is((select provolatile::text||prosecdef::text from pg_proc where oid='public.document_actor_name(text,uuid)'::regprocedure),'strue','stable security definer');

-- a treasurer (no user.manage) cannot read other profiles directly ...
select pg_temp.act(2);
set local role authenticated;
select is((select count(*)::int from public.profiles where id='b6450000-0000-0000-0000-000000000001'),0,
  'treasurer cannot read the admin profile directly');
-- ... but gets the registering user's name of each document it may print
select is(public.document_actor_name('payment',pg_temp.id('pay')),'SAN122 1','payment registrar for treasurer');
select is(public.document_actor_name('delivery_note',pg_temp.id('note')),'SAN122 1','delivery note registrar for treasurer');
select is(public.document_actor_name('settlement',pg_temp.id('set')),'SAN122 1','settlement closer for treasurer');
select is(public.document_actor_name('settlement',pg_temp.id('open')),null,'open settlement has no closer');
select is(public.document_actor_name('payment',gen_random_uuid()),null,'missing document -> null');
select throws_ok($$select public.document_actor_name('profile',pg_temp.id('pay'))$$,'22023',null,'unknown kind refused');
select throws_ok($$select public.document_actor_name(null,pg_temp.id('pay'))$$,'22023',null,'kind required');
-- read-only has bond.view only
select pg_temp.act(3);
select is(public.document_actor_name('delivery_note',pg_temp.id('note')),'SAN122 1','read-only may read the delivery note registrar (bond.view)');
select throws_ok($$select public.document_actor_name('payment',pg_temp.id('pay'))$$,'42501',null,'read-only lacks payment.view');
select throws_ok($$select public.document_actor_name('settlement',pg_temp.id('set'))$$,'42501',null,'read-only lacks settlement permissions');
select is((select count(*)::int from public.profiles where id='b6450000-0000-0000-0000-000000000001'),0,
  'profiles stays closed for read-only');
select * from finish();
rollback;
