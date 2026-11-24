-- SAN-123: draw_complete (roster_frozen -> completed): permission, source status, unresolved-prize
-- precondition, refusals without writes, audit row, grants, and the completed-draw guards afterwards.
begin;
set local time zone 'America/Argentina/Buenos_Aires';
select plan(26);
insert into auth.users(id,email)
values('a6440000-0000-0000-0000-000000000001','san123-admin@example.com'),
('a6440000-0000-0000-0000-000000000002','san123-reader@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status)
select ('b6440000-0000-0000-0000-00000000000'||n)::uuid,
('a6440000-0000-0000-0000-00000000000'||n)::uuid,'SAN123 '||n,'san123-'||n||'@example.com','active'
from generate_series(1,2)n;
insert into public.user_roles(user_id,role_id)
select ('b6440000-0000-0000-0000-00000000000'||n)::uuid,r.id
from (values(1,'admin'),(2,'read-only'))v(n,name) join public.roles r on r.name=v.name;
create temp table ids(k text primary key,id uuid not null);
insert into ids select k,gen_random_uuid() from unnest(array['c','d','scheduled','r','b','n','e','p','p2','buyer','collector'])k;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
create function pg_temp.actor() returns uuid language sql immutable as $$select 'b6440000-0000-0000-0000-000000000001'::uuid$$;
create function pg_temp.act(n int) returns void language sql as $$
select set_config('request.jwt.claims',format('{"sub":"a6440000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
grant execute on function pg_temp.id(text),pg_temp.actor(),pg_temp.act(int) to authenticated;
grant select,update on ids to authenticated;
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode,max_number,associated_number_offset)
values(pg_temp.id('c'),'SAN123',100,1,100,'base_number',999,100);
insert into public.buyers(id,type,first_name) values(pg_temp.id('buyer'),'individual','Frozen');
insert into public.collectors(id,display_name) values(pg_temp.id('collector'),'Frozen');
insert into public.bonds(id,campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
values(pg_temp.id('b'),pg_temp.id('c'),'simple','printed',1,100,'available');
insert into public.bond_numbers(id,campaign_id,bond_id,number_value,number_kind)
values(pg_temp.id('n'),pg_temp.id('c'),pg_temp.id('b'),1,'base');
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
select pg_temp.id(k),pg_temp.id('c'),'final',k,(now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),pg_temp.actor()
from unnest(array['d','scheduled'])k;
insert into public.draw_rosters(id,draw_id,generated_by,created_by)
values(pg_temp.id('r'),pg_temp.id('d'),pg_temp.actor(),pg_temp.actor());
insert into public.draw_roster_entries(id,draw_roster_id,bond_id,bond_number_id,number_value,
buyer_snapshot,collector_snapshot,eligible,ineligibility_reason,created_by)
values(pg_temp.id('e'),pg_temp.id('r'),pg_temp.id('b'),pg_temp.id('n'),1,
jsonb_build_object('id',pg_temp.id('buyer')),jsonb_build_object('id',pg_temp.id('collector')),true,null,pg_temp.actor());
update public.draws set status='roster_generated' where id=pg_temp.id('d');
update public.draw_rosters set status='frozen',frozen_at=now(),frozen_by=pg_temp.actor() where id=pg_temp.id('r');
update public.draws set status='roster_frozen' where id=pg_temp.id('d');

-- grants
select ok(has_function_privilege('authenticated','public.draw_complete(uuid,text)','execute'),'authenticated may execute');
select ok(not has_function_privilege('anon','public.draw_complete(uuid,text)','execute'),'anon may not execute');
select ok(not has_function_privilege('service_role','public.draw_complete(uuid,text)','execute'),'service_role may not execute');
select is((select prosecdef from pg_proc where oid='public.draw_complete(uuid,text)'::regprocedure),true,'security definer');

select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.draw_complete(pg_temp.id('d'),'044-zero')$$,'55000',
  'a draw needs at least one resolved prize to be completed','a draw without prizes cannot be completed');
select lives_ok($$update ids set id=public.prize_create(pg_temp.id('d'),'First',null,1,true,'044-p') where k='p'$$,'prize 1');
select lives_ok($$update ids set id=public.prize_create(pg_temp.id('d'),'Second',null,2,true,'044-p2') where k='p2'$$,'prize 2');
select lives_ok($$select public.draw_load_winning_number(pg_temp.id('p'),1,null,'044-load')$$,'eligible winner pending validation');

-- denied without permission
select pg_temp.act(2);
select throws_ok($$select public.draw_complete(pg_temp.id('d'),'044-denied')$$,'42501',null,'read-only cannot complete');
select pg_temp.act(1);
-- wrong source status
select throws_ok($$select public.draw_complete(pg_temp.id('scheduled'),'044-scheduled')$$,'55000',
  'only draws with a frozen roster can be completed','scheduled draw cannot be completed');
-- unresolved prizes block
select throws_ok($$select public.draw_complete(pg_temp.id('d'),'044-pending')$$,'55000',
  'resolve every prize of the draw before completing it','pending_validation prize blocks completion');
select lives_ok($$select public.prize_resolve(pg_temp.id('p'),'award',null,'044-resolve')$$,'award prize 1');
select throws_ok($$select public.draw_complete(pg_temp.id('d'),'044-pending-unloaded')$$,'55000',
  'resolve every prize of the draw before completing it','a prize without a loaded number also blocks');
select lives_ok($$select public.prize_annul(pg_temp.id('p2'),'Not offered','044-annul')$$,'annul prize 2');
reset role;
select is((select status from public.draws where id=pg_temp.id('d')),'roster_frozen','refusals left the draw frozen');
select is((select count(*)::int from public.audit_log where request_id in ('044-zero','044-denied','044-scheduled','044-pending','044-pending-unloaded')),0,
  'refusals wrote no audit rows');
set local role authenticated;
-- success: annulled prizes do not block, pending_delivery counts as resolved
select lives_ok($$select public.draw_complete(pg_temp.id('d'),'044-complete')$$,'complete the draw');
reset role;
select is((select status from public.draws where id=pg_temp.id('d')),'completed','draw completed');
select is((select action||'|'||entity_type||'|'||(old_value->>'status')||'|'||(new_value->>'status')||'|'||actor_user_id::text
  from public.audit_log where request_id='044-complete'),
  'draw.complete|draw|roster_frozen|completed|'||pg_temp.actor()::text,'one audit row with before/after and actor');
set local role authenticated;
select throws_ok($$select public.draw_complete(pg_temp.id('d'),'044-again')$$,'55000',null,'cannot complete twice');
-- completed-draw guards
select throws_ok($$select public.prize_create(pg_temp.id('d'),'Late',null,3,true,'044-late')$$,'55000',null,
  'no prizes on a completed draw');
select lives_ok($$select public.prize_deliver(pg_temp.id('p'),'Delivered after completion','044-deliver')$$,
  'pending deliveries can still be delivered');
reset role;
select is((select status from public.prizes where id=pg_temp.id('p')),'delivered','delivered after completion');
-- a frozen draw whose only prize was annulled cannot be completed either
reset role;
insert into ids values('d2',gen_random_uuid()),('r2',gen_random_uuid()),('p3',gen_random_uuid());
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
values(pg_temp.id('d2'),pg_temp.id('c'),'final','d2',(now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),pg_temp.actor());
insert into public.draw_rosters(id,draw_id,generated_by,created_by) values(pg_temp.id('r2'),pg_temp.id('d2'),pg_temp.actor(),pg_temp.actor());
update public.draws set status='roster_generated' where id=pg_temp.id('d2');
update public.draw_rosters set status='frozen',frozen_at=now(),frozen_by=pg_temp.actor() where id=pg_temp.id('r2');
update public.draws set status='roster_frozen' where id=pg_temp.id('d2');
set local role authenticated;
select lives_ok($$update ids set id=public.prize_create(pg_temp.id('d2'),'Only',null,1,true,'044-p3') where k='p3'$$,'only prize');
select lives_ok($$select public.prize_annul(pg_temp.id('p3'),'Withdrawn','044-annul-only')$$,'annul the only prize');
select throws_ok($$select public.draw_complete(pg_temp.id('d2'),'044-only-annulled')$$,'55000',
  'a draw needs at least one resolved prize to be completed','only annulled prizes cannot complete a draw');
select * from finish();
rollback;
