-- SAN-105: the treasurer holds sale.view, and only that new grant (no sale write permission).
begin;
select plan(3);
insert into auth.users(id, email) values ('a6620000-0000-0000-0000-000000000001', 'treasurer662@example.com');
insert into public.profiles(id, auth_user_id, full_name, email, status)
values ('b6620000-0000-0000-0000-000000000001', 'a6620000-0000-0000-0000-000000000001', 'Treasurer 662', 'treasurer662@example.com', 'active');
insert into public.user_roles(user_id, role_id) select 'b6620000-0000-0000-0000-000000000001', id from public.roles where name = 'treasurer';
select set_config('request.jwt.claims', '{"sub":"a6620000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select ok(public.has_permission('sale.view'), 'the treasurer holds sale.view');
select ok(public.sale_can_read(), 'the treasurer reads sales through its own permission');
select ok(not public.has_permission('sale.create') and not public.has_permission('sale.correct'),
  'the treasurer still cannot register or correct sales');
reset role;
select * from finish();
rollback;
