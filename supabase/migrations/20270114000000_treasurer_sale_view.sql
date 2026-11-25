-- SAN-105: the treasurer gets `sale.view` (read-only). Decided by Santiago on 2026-11-19 (#50):
-- the treasurer reconciles payments against sales, and a sale's record carries data that `bond.view`
-- alone does not justify reading. No new write path: selling still needs `sale.create`.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'sale.view'
where r.name = 'treasurer'
on conflict do nothing;
