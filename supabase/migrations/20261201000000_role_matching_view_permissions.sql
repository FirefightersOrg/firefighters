-- SAN-93: a role that holds an action permission on a domain also gets that domain's `.view`
-- permission, so it can see the data the action needs. Source of truth: docs/permissions.md.
--
-- The domain of a permission code is everything before its last segment
-- (`buyer.manage` -> `buyer`, `collector.ledger.adjust` -> `collector.ledger`). View permissions
-- (last segment `view` or `view_*`) are not actions. A domain without a `<domain>.view` row
-- (today `sale`, `payment`, `settlement`) is left as is: this migration never creates permissions.
--
-- Added by this migration (admin already holds every permission):
--   operator:  buyer.view (buyer.manage), draw.view (draw.load_winner)
--   treasurer: commission.view (commission.adjust), draw.view (draw.freeze_roster, draw.load_winner)

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
    ('treasurer', 'commission.view'),
    ('treasurer', 'draw.view')
  ) as e (role_name, permission_code)
  where not exists (
    select 1
    from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    join public.permissions p on p.id = rp.permission_id
    where r.name = e.role_name and p.code = e.permission_code
  );

  if v_missing is not null then
    raise exception 'SAN-93 view grants are missing: %', v_missing;
  end if;
end;
$$;
