-- SAN-44: the operator loads and searches bonds by barcode (Phase 4). Grants bond.scan to the
-- operator role (admin already has every permission). Source of truth: docs/permissions.md.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'bond.scan'
where r.name = 'operator'
on conflict do nothing;

do $$
begin
  if not exists (
    select 1
    from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    join public.permissions p on p.id = rp.permission_id
    where r.name = 'operator' and p.code = 'bond.scan'
  ) then
    raise exception 'operator role or bond.scan permission is missing';
  end if;
end;
$$;
