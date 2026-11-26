-- SAN-93 invariant: a role that holds an action permission on a domain also holds that domain's
-- `<domain>.view` permission (`sale`, `payment` and `settlement` have one since SAN-93). The domain is the code
-- without its last segment; codes whose last segment is `view` or `view_*` are not actions, and neither are the
-- own-scope codes ending in `_own` (SAN-143), which open only the caller's own rows.
begin;
select plan(5);

create temp table _action_without_view on commit drop as
select r.name as role_name, a.code as action_code, v.code as view_code
from public.role_permissions rp
join public.roles r on r.id = rp.role_id
join public.permissions a on a.id = rp.permission_id
join public.permissions v on v.code = regexp_replace(a.code, '\.[^.]+$', '') || '.view'
where substring(a.code from '[^.]+$') !~ '^view(_|$)' and a.code !~ '_own$'
  and not exists (
    select 1 from public.role_permissions rp2
    where rp2.role_id = rp.role_id and rp2.permission_id = v.id
  );

select is(
  (select coalesce(string_agg(format('%s: %s without %s', role_name, action_code, view_code), '; '
     order by role_name, action_code), '') from _action_without_view),
  '',
  'every role with an action permission holds the matching view permission'
);

-- Sanity: the invariant query actually sees the action -> view pairs it should.
select ok(
  exists (
    select 1
    from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    join public.permissions p on p.id = rp.permission_id
    where r.name = 'operator' and p.code = 'buyer.view'
  ),
  'operator holds buyer.view (buyer.manage)'
);
select ok(
  exists (
    select 1
    from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    join public.permissions p on p.id = rp.permission_id
    where r.name = 'treasurer' and p.code = 'commission.view'
  ),
  'treasurer holds commission.view (commission.adjust)'
);

select is(
  (select array_agg(code order by code) from public.permissions where code in ('sale.view', 'payment.view', 'settlement.view')),
  array['payment.view', 'sale.view', 'settlement.view'],
  'sale.view, payment.view and settlement.view exist'
);

select is((select count(*)::int from public.role_permissions rp join public.roles r on r.id=rp.role_id join public.permissions p on p.id=rp.permission_id where r.name in ('treasurer','read-only') and p.code in ('buyer.view','collector.view')),4,'treasurer and read-only hold both party view permissions');
select * from finish();
rollback;
