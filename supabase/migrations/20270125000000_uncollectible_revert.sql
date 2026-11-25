-- Follow-up of SAN-106 decided in #50 (Juan, 2026-11-25, answer 2): an uncollectible mark can be
-- REVERTED, by an admin only, with a mandatory audited reason. The sale goes back to its
-- installment-derived financial status; the audit row keeps who marked it, when and why.
--
-- * New permission `sale.revert_uncollectible`, granted to admin only.
-- * `sale_revert_uncollectible(sale, reason, request_id)`: the only path that clears a mark. It sets
--   the transaction-local flag `app.uncollectible_revert` to the sale id; the sales guard only lets a
--   set mark go back to unset under that flag. A reverted sale may be marked again later.
--
-- Errors: 22023 invalid reason; P0002 unknown sale; 55000 sale not active or not marked; 42501.

insert into public.permissions (code, description)
values ('sale.revert_uncollectible', 'Revert the uncollectible mark of a sale, with an audited reason (admin).');
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'sale.revert_uncollectible'
where r.name = 'admin';

-- Same body as 20270115000000, plus: a set mark may be cleared (all three columns back to null) on an
-- active sale, only under the revert flag of that very sale.
create or replace function public.sales_guard_update() returns trigger
language plpgsql set search_path='' as $$
declare
  v_correction boolean := current_setting('app.sale_correction',true) is not distinct from old.id::text;
  v_revert boolean := current_setting('app.uncollectible_revert',true) is not distinct from old.id::text;
begin
  if (to_jsonb(new)-array['buyer_id','collector_id','updated_at','status',
        'uncollectible_at','uncollectible_by','uncollectible_reason'])
    is distinct from (to_jsonb(old)-array['buyer_id','collector_id','updated_at','status',
        'uncollectible_at','uncollectible_by','uncollectible_reason']) then
    raise exception 'sale identity is immutable' using errcode='restrict_violation';
  end if;
  if (new.buyer_id,new.collector_id) is distinct from (old.buyer_id,old.collector_id)
    and not (v_correction and old.status='active' and new.status='active') then
    raise exception 'sale parties require an audited correction' using errcode='restrict_violation';
  end if;
  if new.status is distinct from old.status
    and not (old.status='active' and new.status in ('annulled','corrected')) then
    raise exception 'invalid sale transition' using errcode='check_violation';
  end if;
  if (new.uncollectible_at,new.uncollectible_by,new.uncollectible_reason)
    is distinct from (old.uncollectible_at,old.uncollectible_by,old.uncollectible_reason)
    and not (old.uncollectible_at is null and old.status='active' and new.status='active')
    and not (v_revert and old.uncollectible_at is not null and old.status='active' and new.status='active'
             and new.uncollectible_at is null and new.uncollectible_by is null and new.uncollectible_reason is null) then
    raise exception 'an uncollectible mark is set once, on an active sale, and only cleared by an audited revert'
      using errcode='restrict_violation';
  end if;
  new.updated_at:=now(); return new;
end $$;

create function public.sale_revert_uncollectible(
  p_sale_id uuid,
  p_reason text,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.bond_require_actor('sale.revert_uncollectible');
  v_reason text := nullif(btrim(p_reason), '');
  v_sale public.sales;
  v_old_status text;
  v_new_status text;
begin
  if p_sale_id is null or v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'sale id and reason (1..1000 characters) are required'
      using errcode = 'invalid_parameter_value';
  end if;
  -- Lock order sale -> bond, the same as marking and as payment admission.
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'sale not found' using errcode = 'no_data_found';
  end if;
  if v_sale.status <> 'active' then
    raise exception 'only an active sale can have its uncollectible mark reverted (status: %)', v_sale.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v_sale.uncollectible_at is null then
    raise exception 'sale is not marked uncollectible' using errcode = 'object_not_in_prerequisite_state';
  end if;
  select financial_status_snapshot into v_old_status from public.bonds where id = v_sale.bond_id for update;

  perform set_config('app.uncollectible_revert', p_sale_id::text, true);
  update public.sales
  set uncollectible_at = null, uncollectible_by = null, uncollectible_reason = null
  where id = p_sale_id;
  perform set_config('app.uncollectible_revert', '', true);
  v_new_status := public.bond_financial_status_from_installments(v_sale.bond_id);
  update public.bonds set financial_status_snapshot = v_new_status where id = v_sale.bond_id;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (v_actor, 'sale.revert_uncollectible', 'sale', p_sale_id::text,
    jsonb_build_object('campaign_id', v_sale.campaign_id, 'bond_id', v_sale.bond_id,
      'financial_status_snapshot', v_old_status, 'uncollectible', true,
      'uncollectible_at', v_sale.uncollectible_at, 'uncollectible_by', v_sale.uncollectible_by,
      'uncollectible_reason', v_sale.uncollectible_reason),
    jsonb_build_object('campaign_id', v_sale.campaign_id, 'bond_id', v_sale.bond_id,
      'financial_status_snapshot', v_new_status, 'uncollectible', false, 'reason', v_reason),
    v_reason, p_request_id);
end;
$$;

revoke all on function public.sale_revert_uncollectible(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sale_revert_uncollectible(uuid, text, text) to authenticated;
comment on function public.sale_revert_uncollectible(uuid, text, text) is
  'Reverts the uncollectible mark of an active sale (admin, mandatory audited reason); the sale gets its installment-derived status back.';
