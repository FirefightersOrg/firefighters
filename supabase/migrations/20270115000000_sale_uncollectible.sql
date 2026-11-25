-- SAN-106 (part 1): `uncollectible` is MANUAL ONLY, decided by Santiago on 2026-11-19 (issue #50).
-- An admin or the treasurer marks an active sale with a mandatory reason, and the mark is audited.
-- Nothing marks a sale automatically (the overdue warning of SAN-142 is informative only). The mark
-- is final: there is no unmark path.
--
-- The first-due-date window part of SAN-106 is pending: sale_register has no sale date other than
-- today, so the decided window [sale date, +1 year] needs a product answer first (see the PR).
--
-- Errors: 22023 invalid reason; P0002 unknown sale; 55000 sale not active or already
-- marked; 42501 no permission.

-- ---------------------------------------------------------------------------
-- Permission: admin and treasurer
-- ---------------------------------------------------------------------------
insert into public.permissions (code, description)
values ('sale.mark_uncollectible', 'Mark an active sale as uncollectible, with an audited reason.');
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'sale.mark_uncollectible'
where r.name in ('admin', 'treasurer');

-- ---------------------------------------------------------------------------
-- The mark lives on the sale: who, when and why. All three or none.
-- ---------------------------------------------------------------------------
alter table public.sales
  add column uncollectible_at timestamptz,
  add column uncollectible_by uuid references public.profiles (id) on delete restrict,
  add column uncollectible_reason text,
  add constraint sales_uncollectible_complete check (
    (uncollectible_at is null and uncollectible_by is null and uncollectible_reason is null)
    or (uncollectible_at is not null and uncollectible_by is not null
        and uncollectible_reason is not null and btrim(uncollectible_reason) <> ''
        and char_length(uncollectible_reason) <= 1000)
  );

create index sales_uncollectible_by_idx on public.sales (uncollectible_by)
  where uncollectible_by is not null;

comment on column public.sales.uncollectible_at is
  'When the sale was marked uncollectible (SAN-106, manual only). Null when not marked.';
comment on column public.sales.uncollectible_by is
  'Profile that marked the sale uncollectible (SAN-106).';
comment on column public.sales.uncollectible_reason is
  'Mandatory reason given when the sale was marked uncollectible (SAN-106).';

-- Same body as 20261220000000 (sale corrections), plus: the uncollectible mark may only go from
-- unset to set, on an active sale, and never in the same update as a status change.
create or replace function public.sales_guard_update() returns trigger
language plpgsql set search_path='' as $$
declare v_correction boolean := current_setting('app.sale_correction',true) is not distinct from old.id::text;
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
    and not (old.uncollectible_at is null and old.status='active' and new.status='active') then
    raise exception 'an uncollectible mark is set once, on an active sale, and never removed'
      using errcode='restrict_violation';
  end if;
  new.updated_at:=now(); return new;
end $$;

-- ---------------------------------------------------------------------------
-- Financial status: the mark wins over every installment-derived status (docs/state-machines.md
-- precedence: annulled > uncollectible > fully paid > overdue > ...). Otherwise unchanged from
-- 20261215000000.
-- ---------------------------------------------------------------------------
create or replace function public.bond_financial_status_from_installments(p_bond_id uuid)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_status text;
begin
  -- No active sale retains the existing snapshot; a marked sale is uncollectible; paid-only plans
  -- are fully paid. An overdue installment wins; otherwise plans due through today are up to date.
  select case
    when not exists (select 1 from public.sales s where s.bond_id = b.id and s.status = 'active') then b.financial_status_snapshot
    when exists (select 1 from public.sales s where s.bond_id = b.id and s.status = 'active' and s.uncollectible_at is not null) then 'uncollectible'
    when not exists (select 1 from public.sales s join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active' join public.installments i on i.payment_plan_id = pp.id where s.bond_id = b.id and s.status = 'active' and i.status in ('paid', 'paid_advance')) then 'no_payments'
    when not exists (select 1 from public.sales s join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active' join public.installments i on i.payment_plan_id = pp.id where s.bond_id = b.id and s.status = 'active' and i.status not in ('paid', 'paid_advance')) then 'fully_paid'
    when exists (select 1 from public.sales s join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active' join public.installments i on i.payment_plan_id = pp.id where s.bond_id = b.id and s.status = 'active' and (i.status = 'overdue' or (i.status = 'pending' and i.due_date < v_today))) then 'overdue'
    when not exists (select 1 from public.sales s join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active' join public.installments i on i.payment_plan_id = pp.id where s.bond_id = b.id and s.status = 'active' and i.due_date <= v_today and i.status not in ('paid', 'paid_advance')) then 'up_to_date'
    else 'partial_payments'
  end into v_status
  from public.bonds b
  where b.id = p_bond_id;
  return v_status;
end $$;

comment on function public.bond_financial_status_from_installments(uuid) is
  'Returns the bond financial snapshot: uncollectible (manual mark), no payments, fully paid, overdue, up to date, or partial payments; inactive sales preserve the current snapshot.';

-- ---------------------------------------------------------------------------
-- sale_mark_uncollectible: the only write path for the mark.
-- Lock order sale -> bond, the same as payment admission (sale SHARE, then the bond snapshot), so
-- a payment recorded right after recomputes the snapshot with the mark already visible.
-- ---------------------------------------------------------------------------
create function public.sale_mark_uncollectible(
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
  v_actor uuid := public.bond_require_actor('sale.mark_uncollectible');
  v_reason text := nullif(btrim(p_reason), '');
  v_sale public.sales;
  v_old_status text;
  v_new_status text;
begin
  if p_sale_id is null or v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'sale id and reason (1..1000 characters) are required'
      using errcode = 'invalid_parameter_value';
  end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'sale not found' using errcode = 'no_data_found';
  end if;
  if v_sale.status <> 'active' then
    raise exception 'only an active sale can be marked uncollectible (status: %)', v_sale.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v_sale.uncollectible_at is not null then
    raise exception 'sale is already marked uncollectible'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  select financial_status_snapshot into v_old_status from public.bonds where id = v_sale.bond_id for update;

  update public.sales
  set uncollectible_at = now(), uncollectible_by = v_actor, uncollectible_reason = v_reason
  where id = p_sale_id;
  v_new_status := public.bond_financial_status_from_installments(v_sale.bond_id);
  update public.bonds set financial_status_snapshot = v_new_status where id = v_sale.bond_id;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (v_actor, 'sale.mark_uncollectible', 'sale', p_sale_id::text,
    jsonb_build_object('campaign_id', v_sale.campaign_id, 'bond_id', v_sale.bond_id,
      'financial_status_snapshot', v_old_status, 'uncollectible', false),
    jsonb_build_object('campaign_id', v_sale.campaign_id, 'bond_id', v_sale.bond_id,
      'financial_status_snapshot', v_new_status, 'uncollectible', true, 'reason', v_reason),
    v_reason, p_request_id);
end;
$$;

revoke all on function public.sale_mark_uncollectible(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sale_mark_uncollectible(uuid, text, text) to authenticated;
comment on function public.sale_mark_uncollectible(uuid, text, text) is
  'SAN-106: marks an active sale uncollectible (manual only, admin or treasurer), with a mandatory audited reason.';
