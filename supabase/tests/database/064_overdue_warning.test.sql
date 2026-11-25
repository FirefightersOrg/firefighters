-- SAN-142: reports warn about active, unmarked sales with N or more overdue installments; N is set
-- per campaign (audited, campaign.update_rules). The warning never marks anything.
begin;
select plan(30);

insert into auth.users (id, email)
select ('a6640000-0000-0000-0000-00000000000' || n)::uuid, 'overdue-' || n || '@example.com'
from generate_series(1, 4) n;
insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b6640000-0000-0000-0000-00000000000' || n)::uuid,
  ('a6640000-0000-0000-0000-00000000000' || n)::uuid, 'Overdue ' || n, 'overdue-' || n || '@example.com', 'active'
from generate_series(1, 4) n;
insert into public.user_roles (user_id, role_id)
select v.id::uuid, r.id from (values
  ('b6640000-0000-0000-0000-000000000001', 'admin'),
  ('b6640000-0000-0000-0000-000000000002', 'operator'),
  ('b6640000-0000-0000-0000-000000000003', 'read-only'),
  ('b6640000-0000-0000-0000-000000000004', 'collector')
) v(id, role_name) join public.roles r on r.name = v.role_name;
create function pg_temp.act_as(n int) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"a6640000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true)
$$;
grant execute on function pg_temp.act_as(int) to authenticated;
create temporary table ids (k text primary key, id uuid not null);
grant select on ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated;
create function pg_temp.flagged(p_collector uuid default null) returns text language sql stable as $$
  select coalesce(string_agg(k, ',' order by k), '') from public.report_overdue_sales(pg_temp.id('campaign'), p_collector) r
  join ids on ids.id = r.sale_id
$$;
grant execute on function pg_temp.flagged(uuid) to authenticated;

with x as (insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Overdue campaign', 400, 4, 100, 'base_number') returning id) insert into ids select 'campaign', id from x;
update public.campaigns set status = 'active', starts_at = current_date - 200, ends_at = current_date + 200
where id = pg_temp.id('campaign');
with x as (insert into public.collectors (display_name) values ('Collector A') returning id) insert into ids select 'ca', id from x;
with x as (insert into public.collectors (display_name) values ('Collector B') returning id) insert into ids select 'cb', id from x;
with x as (insert into public.buyers (type, first_name) values ('individual', 'Overdue buyer') returning id) insert into ids select 'buyer', id from x;

-- Sales of 4 installments of 100, due 90/60/30 days ago and in 30 days, unless said otherwise:
--   s3     collector A, 3 overdue                      -> flagged at N=3
--   s2     collector A, first due 60 days ago: 2 overdue -> flagged only at N<=2
--   spaid  collector A, 3 past due but the first paid: 2 overdue
--   smark  collector A, 3 overdue but marked uncollectible (SAN-106) -> never listed
--   sann   collector A, 3 overdue but the sale is annulled          -> never listed
--   sb     collector B, 3 overdue                      -> flagged at N=3
--   sedge  collector A, Buenos Aires rule edges: one explicit `overdue`, one `annulled` past due,
--          one due today (not overdue yet) and one future -> 1 overdue
do $$
declare k text; b uuid; s uuid; pp uuid; v_first int; v_collector uuid;
begin
  foreach k in array array['s3', 's2', 'spaid', 'smark', 'sann', 'sb', 'sedge'] loop
    v_first := case when k = 's2' then 60 when k = 'sedge' then 60 else 90 end;
    v_collector := case when k = 'sb' then pg_temp.id('cb') else pg_temp.id('ca') end;
    insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
    values (pg_temp.id('campaign'), 'simple', 'printed', 1, 400, 'available') returning id into b;
    insert into public.sales (campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
    values (pg_temp.id('campaign'), b, pg_temp.id('buyer'), v_collector, 'installments', 400,
      'b6640000-0000-0000-0000-000000000001') returning id into s;
    insert into public.payment_plans (sale_id, installment_count, total_amount) values (s, 4, 400) returning id into pp;
    insert into public.installments (payment_plan_id, installment_number, due_date, amount)
    select pp, n, (now() at time zone 'America/Argentina/Buenos_Aires')::date - v_first + (n - 1) * 30, 100
    from generate_series(1, 4) n;
    insert into ids values (k, s);
  end loop;
end $$;
update public.installments i set status = 'paid' from public.payment_plans pp
where pp.id = i.payment_plan_id and pp.sale_id = pg_temp.id('spaid') and i.installment_number = 1;
-- sedge: due 60 / 30 days ago, today and in 30 days. #1 explicitly overdue; #2 paid then annulled;
-- #3 is due today (Buenos Aires), which is not overdue yet.
update public.installments i set status = 'overdue' from public.payment_plans pp
where pp.id = i.payment_plan_id and pp.sale_id = pg_temp.id('sedge') and i.installment_number = 1;
update public.installments i set status = 'paid' from public.payment_plans pp
where pp.id = i.payment_plan_id and pp.sale_id = pg_temp.id('sedge') and i.installment_number = 2;
update public.installments i set status = 'annulled' from public.payment_plans pp
where pp.id = i.payment_plan_id and pp.sale_id = pg_temp.id('sedge') and i.installment_number = 2;
update public.sales set uncollectible_at = now(), uncollectible_by = 'b6640000-0000-0000-0000-000000000001',
  uncollectible_reason = 'Gone' where id = pg_temp.id('smark');
update public.sales set status = 'annulled' where id = pg_temp.id('sann');

-- 1. The default threshold and the report.
select is((select overdue_warning_threshold from public.campaigns where id = pg_temp.id('campaign')), 3,
  'a campaign warns from 3 overdue installments by default');
set local role authenticated;
select pg_temp.act_as(3);
select is(pg_temp.flagged(), 's3,sb', 'read-only sees the sales with 3+ overdue installments, not marked or annulled ones');
select is((select row(overdue_count, overdue_amount, oldest_due_date, threshold, collector_name)::text
  from public.report_overdue_sales(pg_temp.id('campaign')) where sale_id = pg_temp.id('s3')),
  row(3::bigint, '300.00', (now() at time zone 'America/Argentina/Buenos_Aires')::date - 90, 3, 'Collector A')::text,
  'the row carries the overdue count, amount, oldest due date, threshold and collector');
select ok((select bond_label = '—' from public.report_overdue_sales(pg_temp.id('campaign')) where sale_id = pg_temp.id('s3')),
  'a bond without base numbers is labelled with a dash, never with its UUID (SAN-149)');
select is(pg_temp.flagged(pg_temp.id('cb')), 'sb', 'the collector filter narrows the list');
select is((select string_agg(ids.k, ',' order by r.overdue_count desc, r.oldest_due_date, r.sale_id)
  from public.report_overdue_sales(pg_temp.id('campaign'), null, 1, 1) r join ids on ids.id = r.sale_id),
  (select string_agg(ids.k, ',' order by r.overdue_count desc, r.oldest_due_date, r.sale_id)
   from (select * from public.report_overdue_sales(pg_temp.id('campaign')) offset 1 limit 1) r join ids on ids.id = r.sale_id),
  'p_limit / p_offset page the ordered list');
select pg_temp.act_as(4);
select throws_ok($$select * from public.report_overdue_sales(pg_temp.id('campaign'))$$, '42501', null,
  'a collector login cannot read the report');
select pg_temp.act_as(1);
select throws_ok($$select * from public.report_overdue_sales('00000000-0000-0000-0000-000000000001')$$, 'P0002', null,
  'an unknown campaign is rejected');

-- 2. Setting N: campaign.update_rules only, 1..120, audited.
select pg_temp.act_as(2);
select throws_ok($$select public.campaign_set_overdue_warning_threshold(pg_temp.id('campaign'), 2)$$, '42501', null,
  'the operator cannot change the threshold');
select pg_temp.act_as(3);
select throws_ok($$select public.campaign_set_overdue_warning_threshold(pg_temp.id('campaign'), 2)$$, '42501', null,
  'read-only cannot change the threshold');
select pg_temp.act_as(1);
select throws_ok($$select public.campaign_set_overdue_warning_threshold(pg_temp.id('campaign'), 0)$$, '22023', null, 'N = 0 is rejected');
select throws_ok($$select public.campaign_set_overdue_warning_threshold(pg_temp.id('campaign'), 121)$$, '22023', null, 'N = 121 is rejected');
select throws_ok($$select public.campaign_set_overdue_warning_threshold(pg_temp.id('campaign'), null)$$, '22023', null, 'a null N is rejected');
select throws_ok($$select public.campaign_set_overdue_warning_threshold('00000000-0000-0000-0000-000000000001', 2)$$, 'P0002', null,
  'an unknown campaign is rejected');
select lives_ok($$select public.campaign_set_overdue_warning_threshold(pg_temp.id('campaign'), 2, 'req-664')$$,
  'the admin sets N = 2');
select is(pg_temp.flagged(), 's2,s3,sb,spaid', 'with N = 2, sales with 2 overdue installments are listed too');
select is((select threshold from public.report_overdue_sales(pg_temp.id('campaign')) limit 1), 2, 'rows report the current N');
select lives_ok($$select public.campaign_set_overdue_warning_threshold(pg_temp.id('campaign'), 1)$$, 'the admin sets N = 1');
select is((select row(overdue_count, overdue_amount, oldest_due_date)::text from public.report_overdue_sales(pg_temp.id('campaign'))
  where sale_id = pg_temp.id('sedge')),
  row(1::bigint, '100.00', (now() at time zone 'America/Argentina/Buenos_Aires')::date - 60)::text,
  'an explicit overdue counts; an annulled past installment and one due today (Buenos Aires) do not');
select is(pg_temp.flagged(), 's2,s3,sb,sedge,spaid', 'with N = 1 every sale with an overdue installment is listed');
select lives_ok($$select public.campaign_set_overdue_warning_threshold(pg_temp.id('campaign'), 2, 'req-664b')$$, 'back to N = 2');
reset role;
select is((select row(actor_user_id, request_id, old_value ->> 'overdue_warning_threshold', new_value ->> 'overdue_warning_threshold', campaign_scope)::text
  from public.audit_log where action = 'campaign.update_overdue_warning' and entity_id = pg_temp.id('campaign')::text
    and request_id = 'req-664'),
  row('b6640000-0000-0000-0000-000000000001'::uuid, 'req-664', '3', '2', pg_temp.id('campaign')::text)::text,
  'one audit row with the old and new N and the campaign scope');
set local role authenticated;
select pg_temp.act_as(1);
select lives_ok($$select public.campaign_set_overdue_warning_threshold(pg_temp.id('campaign'), 2)$$, 'setting the same N is a no-op');
reset role;
select is((select count(*)::int from public.audit_log where action = 'campaign.update_overdue_warning'
  and entity_id = pg_temp.id('campaign')::text), 3, 'an unchanged N writes no audit row (3 -> 2 -> 1 -> 2 only)');

-- 3. Informative only: nothing about the sales changed.
select is((select count(*)::int from public.sales where campaign_id = pg_temp.id('campaign') and uncollectible_at is not null), 1,
  'the warning marks nothing uncollectible (only the hand-marked sale is)');

-- 4. Frozen once the campaign is closed.
update public.campaigns set status = 'closing' where id = pg_temp.id('campaign');
update public.campaigns set status = 'closed' where id = pg_temp.id('campaign');
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok($$select public.campaign_set_overdue_warning_threshold(pg_temp.id('campaign'), 4)$$, '55000', null,
  'the threshold cannot change on a closed campaign');
reset role;
select throws_ok($$update public.campaigns set overdue_warning_threshold = 4 where id = pg_temp.id('campaign')$$, '55000', null,
  'a direct write cannot change the threshold of a closed campaign either');
with x as (insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Overdue draft', 400, 4, 100, 'base_number') returning id) insert into ids select 'draft', id from x;
select throws_ok($$update public.campaigns set overdue_warning_threshold = 0 where id = pg_temp.id('draft')$$, '23514', null,
  'the column rejects values outside 1..120');

-- 5. Grants.
select ok(not has_function_privilege('anon', 'public.report_overdue_sales(uuid,uuid,integer,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.report_overdue_sales(uuid,uuid,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.report_overdue_sales(uuid,uuid,integer,integer)', 'execute'),
  'only authenticated can execute report_overdue_sales');
select ok(not has_function_privilege('anon', 'public.campaign_set_overdue_warning_threshold(uuid,integer,text)', 'execute')
  and not has_function_privilege('service_role', 'public.campaign_set_overdue_warning_threshold(uuid,integer,text)', 'execute')
  and has_function_privilege('authenticated', 'public.campaign_set_overdue_warning_threshold(uuid,integer,text)', 'execute'),
  'only authenticated can execute campaign_set_overdue_warning_threshold');

select * from finish();
rollback;
