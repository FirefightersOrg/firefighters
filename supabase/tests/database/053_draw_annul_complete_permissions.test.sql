-- SAN-118: draw.update alone must not authorize lifecycle transitions.
begin;
select plan(27);
insert into auth.users(id,email)
values ('a6460000-0000-0000-0000-000000000001','san118-admin@example.com'),
       ('a6460000-0000-0000-0000-000000000002','san118-editor@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status)
select ('b6460000-0000-0000-0000-00000000000'||n)::uuid,
       ('a6460000-0000-0000-0000-00000000000'||n)::uuid,
       'SAN118 '||n,'san118-'||n||'@example.com','active'
from generate_series(1,2)n;

-- Check seeds BEFORE adding a dedicated custom editor role.
select is((select count(*)::int from public.permissions where code in ('draw.annul','draw.complete')),
  2,'both permissions seeded');
select is((select array_agg(r.name||':'||p.code order by p.code)
  from public.role_permissions rp join public.roles r on r.id=rp.role_id
  join public.permissions p on p.id=rp.permission_id
  where p.code in ('draw.annul','draw.complete')),
  array['admin:draw.annul','admin:draw.complete'],'only admin receives lifecycle permissions');
insert into public.roles(name) values ('san118-editor');
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.name='san118-editor' and p.code in ('campaign.view','draw.view','draw.update');
insert into public.user_roles(user_id,role_id)
select ('b6460000-0000-0000-0000-00000000000'||n)::uuid,r.id
from (values (1,'admin'),(2,'san118-editor'))v(n,name) join public.roles r on r.name=v.name;

create temp table ids(k text primary key,id uuid not null);
insert into ids select k,gen_random_uuid() from unnest(array['c','scheduled','frozen','roster','prize'])k;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
create function pg_temp.actor() returns uuid language sql immutable as $$select 'b6460000-0000-0000-0000-000000000001'::uuid$$;
create function pg_temp.act(n int) returns void language sql as $$
select set_config('request.jwt.claims',format('{"sub":"a6460000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
grant execute on function pg_temp.id(text),pg_temp.actor(),pg_temp.act(int) to authenticated;
grant select on ids to authenticated;
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode,max_number,associated_number_offset)
values(pg_temp.id('c'),'SAN118',100,1,100,'base_number',999,100);
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
select pg_temp.id(k),pg_temp.id('c'),'final',k,
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),pg_temp.actor()
from unnest(array['scheduled','frozen'])k;
insert into public.draw_rosters(id,draw_id,generated_by,created_by)
values(pg_temp.id('roster'),pg_temp.id('frozen'),pg_temp.actor(),pg_temp.actor());
update public.draws set status='roster_generated' where id=pg_temp.id('frozen');
update public.draw_rosters set status='frozen',frozen_at=now(),frozen_by=pg_temp.actor() where id=pg_temp.id('roster');
update public.draws set status='roster_frozen' where id=pg_temp.id('frozen');
insert into public.prizes(id,draw_id,name,position,created_by)
values(pg_temp.id('prize'),pg_temp.id('frozen'),'Resolved prize',1,pg_temp.actor());
update public.prizes set status='unawarded' where id=pg_temp.id('prize');
create temp table before_draws as select * from public.draws where id in (pg_temp.id('scheduled'),pg_temp.id('frozen'));

select ok(has_function_privilege('authenticated',f,'execute'),'authenticated can execute '||f)
from unnest(array['public.draw_annul(uuid,text,text)','public.draw_complete(uuid,text)'])f;
select ok(not has_function_privilege(r,f,'execute'),r||' cannot execute '||f)
from unnest(array['anon','service_role'])r
cross join unnest(array['public.draw_annul(uuid,text,text)','public.draw_complete(uuid,text)'])f;

select pg_temp.act(2);
set local role authenticated;
select ok(public.has_permission('draw.update'),'custom editor has draw.update');
select ok(not public.has_permission('draw.annul'),'custom editor lacks draw.annul');
select ok(not public.has_permission('draw.complete'),'custom editor lacks draw.complete');
select throws_ok($$select public.draw_annul(pg_temp.id('scheduled'),'Reason','046-denied-annul')$$,
  '42501',null,'draw.update cannot annul');
select throws_ok($$select public.draw_complete(pg_temp.id('frozen'),'046-denied-complete')$$,
  '42501',null,'draw.update cannot complete');
select throws_ok($$update public.draws set status='annulled' where id=pg_temp.id('scheduled')$$,
  '42501',null,'direct DML remains blocked');
reset role;
select is((select count(*)::int from public.audit_log where request_id in ('046-denied-annul','046-denied-complete')),
  0,'permission denials write no audit');
select is((select jsonb_agg(to_jsonb(d) order by id) from public.draws d where id in (pg_temp.id('scheduled'),pg_temp.id('frozen'))),
  (select jsonb_agg(to_jsonb(d) order by id) from before_draws d),'permission denials leave every draw field unchanged');

select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.draw_annul(pg_temp.id('scheduled'),' ','046-invalid')$$,
  '22023',null,'annulment still validates reason');
select throws_ok($$select public.draw_complete(pg_temp.id('scheduled'),'046-wrong-state')$$,
  '55000',null,'completion still validates source state');
select lives_ok($$select public.draw_annul(pg_temp.id('scheduled'),' Reason ','046-annul')$$,'admin can annul');
select lives_ok($$select public.draw_complete(pg_temp.id('frozen'),'046-complete')$$,'admin can complete');
select throws_ok($$select public.draw_complete(pg_temp.id('frozen'),'046-again')$$,
  '55000',null,'completion cannot duplicate history');
reset role;
select is((select status||'|'||annul_reason||'|'||annulled_by::text from public.draws where id=pg_temp.id('scheduled')),
  'annulled|Reason|'||pg_temp.actor()::text,'annulment keeps reason and actor');
select is((select status from public.draws where id=pg_temp.id('frozen')),'completed','completed status');
select is((select count(*)::int from public.audit_log where request_id in ('046-invalid','046-wrong-state','046-again')),
  0,'validation failures write no audit');
select is((select action||'|'||(old_value->>'status')||'|'||(new_value->>'status')||'|'||reason||'|'||actor_user_id::text
  from public.audit_log where request_id='046-annul' and entity_id=pg_temp.id('scheduled')::text),
  'draw.annul|scheduled|annulled|Reason|'||pg_temp.actor()::text,'annulment audit is unchanged');
select is((select action||'|'||(old_value->>'status')||'|'||(new_value->>'status')||'|'||actor_user_id::text
  from public.audit_log where request_id='046-complete' and entity_id=pg_temp.id('frozen')::text),
  'draw.complete|roster_frozen|completed|'||pg_temp.actor()::text,'completion audit is unchanged');
select is((select count(*)::int from public.audit_log where request_id in ('046-annul','046-complete')),
  2,'exactly one audit per transition');
select * from finish();
rollback;
