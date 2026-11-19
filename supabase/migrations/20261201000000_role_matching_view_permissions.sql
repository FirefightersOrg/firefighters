-- SAN-93: role matrix decisions.
--
-- 1. New permissions `sale.view`, `payment.view` and `settlement.view`.
-- 2. A role that holds an action permission on a domain also gets that domain's `.view`
--    permission, so it can see the data the action needs. Source of truth: docs/permissions.md.
-- 3. Explicit grants: operator gets collector.view, settlement.update_open and bond.return, treasurer gets
--    collector.ledger.view, read-only gets commission.view, collector gets campaign.view.
--
-- The domain of a permission code is everything before its last segment
-- (`buyer.manage` -> `buyer`, `collector.ledger.adjust` -> `collector.ledger`). View permissions
-- (last segment `view` or `view_*`) are not actions.
--
-- Added by this migration (admin receives every new permission):
--   operator:  buyer.view (buyer.manage), draw.view (draw.load_winner),
--              sale.view (sale.create), payment.view (payment.create),
--              settlement.view (settlement.create, settlement.update_open),
--              collector.view, settlement.update_open, bond.return (not bond.mark_lost)
--   treasurer: commission.view (commission.adjust), draw.view (draw.freeze_roster, draw.load_winner),
--              payment.view (payment.create, payment.annul),
--              settlement.view (settlement.create, settlement.close, settlement.correct),
--              collector.ledger.view
--   read-only: commission.view
--   collector: campaign.view

insert into public.permissions (code, description) values
  ('sale.view', 'View sales.'),
  ('payment.view', 'View payments.'),
  ('settlement.view', 'View settlements.')
on conflict (code) do update set description = excluded.description;

-- admin holds every permission.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'admin'
on conflict do nothing;

-- Explicit grants. Staged so an unknown role or permission fails the migration.
create temporary table _san93_grants (role_name text not null, permission_code text not null);

insert into _san93_grants (role_name, permission_code) values
  ('operator', 'collector.view'),
  ('operator', 'settlement.update_open'),
  ('operator', 'bond.return'),
  ('treasurer', 'collector.ledger.view'),
  ('read-only', 'commission.view'),
  ('collector', 'campaign.view');

do $$
declare
  v_unknown text;
begin
  select string_agg(format('(%s, %s)', g.role_name, g.permission_code), ', ')
  into v_unknown
  from _san93_grants g
  left join public.roles r on r.name = g.role_name
  left join public.permissions p on p.code = g.permission_code
  where r.id is null or p.id is null;

  if v_unknown is not null then
    raise exception 'SAN-93 grants reference unknown roles or permissions: %', v_unknown;
  end if;
end;
$$;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from _san93_grants g
join public.roles r on r.name = g.role_name
join public.permissions p on p.code = g.permission_code
on conflict do nothing;

drop table _san93_grants;

-- Action implies view (runs after the explicit grants, so settlement.update_open counts).
insert into public.role_permissions (role_id, permission_id)
select distinct rp.role_id, v.id
from public.role_permissions rp
join public.permissions a on a.id = rp.permission_id
join public.permissions v on v.code = regexp_replace(a.code, '\.[^.]+$', '') || '.view'
where substring(a.code from '[^.]+$') !~ '^view(_|$)'
on conflict do nothing;

-- Guard: the grants listed above exist (the invariant itself is checked by pgTAP 017).
do $$
declare
  v_missing text;
begin
  select string_agg(format('(%s, %s)', e.role_name, e.permission_code), ', ')
  into v_missing
  from (values
    ('operator', 'buyer.view'),
    ('operator', 'draw.view'),
    ('operator', 'sale.view'),
    ('operator', 'payment.view'),
    ('operator', 'settlement.view'),
    ('operator', 'collector.view'),
    ('operator', 'settlement.update_open'),
    ('operator', 'bond.return'),
    ('treasurer', 'commission.view'),
    ('treasurer', 'draw.view'),
    ('treasurer', 'payment.view'),
    ('treasurer', 'settlement.view'),
    ('treasurer', 'collector.ledger.view'),
    ('read-only', 'commission.view'),
    ('collector', 'campaign.view')
  ) as e (role_name, permission_code)
  where not exists (
    select 1
    from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    join public.permissions p on p.id = rp.permission_id
    where r.name = e.role_name and p.code = e.permission_code
  );

  if v_missing is not null then
    raise exception 'SAN-93 grants are missing: %', v_missing;
  end if;
end;
$$;
