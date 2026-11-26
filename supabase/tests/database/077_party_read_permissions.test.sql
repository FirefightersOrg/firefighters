begin;
select plan(2);
select is(count(*)::int, 4, 'both roles can read buyers and collectors')
from public.role_permissions rp join public.roles r on r.id = rp.role_id
join public.permissions p on p.id = rp.permission_id
where r.name in ('treasurer','read-only') and p.code in ('buyer.view','collector.view');
select is(count(*)::int, 0, 'neither role can manage buyers or collectors')
from public.role_permissions rp join public.roles r on r.id = rp.role_id
join public.permissions p on p.id = rp.permission_id
where r.name in ('treasurer','read-only') and p.code in ('buyer.manage','collector.manage');
select * from finish();
rollback;
