insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.name in ('treasurer', 'read-only') and p.code in ('buyer.view', 'collector.view')
on conflict (role_id, permission_id) do nothing;
