-- SAN-142: overdue-installments warning in reports, with N configurable per campaign. Approved by
-- Santiago on 2026-11-24 (#50). The warning is INFORMATIVE ONLY: it never marks a sale
-- uncollectible (that stays manual, SAN-106).
--
-- * campaigns.overdue_warning_threshold (N): a sale is flagged when it has N or more overdue
--   installments. Default 3; 1..120 (the installment-count limit).
-- * campaign_set_overdue_warning_threshold: the only write path, audited, permission
--   campaign.update_rules (the campaign's commercial rules).
-- * report_overdue_sales: active, unmarked sales with >= N overdue installments. Same access rule
--   as the other operational reports (report.view_operational + campaign.view, SECURITY DEFINER,
--   no buyer data). "Overdue" is the same rule as report_installments and the bond snapshot:
--   status overdue, or pending with a due date before today in Buenos Aires.
--
-- Errors: 22023 invalid threshold; P0002 unknown campaign; 55000 closed/annulled campaign;
-- 42501 no permission.

alter table public.campaigns
  add column overdue_warning_threshold integer not null default 3,
  add constraint campaigns_overdue_warning_threshold_check
    check (overdue_warning_threshold between 1 and 120);

-- The freeze on closed/annulled campaigns also holds for direct writes (service_role, migrations),
-- not only through the RPC (#138 review). A separate trigger keeps campaigns_guard_write untouched.
create function public.campaigns_guard_overdue_warning_threshold()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.overdue_warning_threshold is distinct from old.overdue_warning_threshold
     and old.status in ('closed', 'annulled') then
    raise exception 'the overdue warning threshold cannot change once the campaign is %', old.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return new;
end;
$$;
revoke all on function public.campaigns_guard_overdue_warning_threshold()
  from public, anon, authenticated, service_role;
create trigger campaigns_guard_overdue_warning_threshold before update of overdue_warning_threshold
  on public.campaigns for each row execute function public.campaigns_guard_overdue_warning_threshold();

comment on column public.campaigns.overdue_warning_threshold is
  'SAN-142: reports warn about a sale with this many overdue installments or more. Informative only.';

create function public.campaign_set_overdue_warning_threshold(
  p_campaign_id uuid,
  p_threshold integer,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.bond_require_actor('campaign.update_rules');
  v_old integer;
  v_status text;
begin
  if p_threshold is null or p_threshold not between 1 and 120 then
    raise exception 'overdue warning threshold must be between 1 and 120'
      using errcode = 'invalid_parameter_value';
  end if;
  select overdue_warning_threshold, status into v_old, v_status
  from public.campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'campaign % not found', p_campaign_id using errcode = 'no_data_found';
  end if;
  -- Like the name, the threshold is frozen once the campaign is closed or annulled.
  if v_status in ('closed', 'annulled') then
    raise exception 'the overdue warning threshold cannot change once the campaign is %', v_status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v_old = p_threshold then
    return;
  end if;
  update public.campaigns set overdue_warning_threshold = p_threshold where id = p_campaign_id;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, request_id)
  values (v_actor, 'campaign.update_overdue_warning', 'campaign', p_campaign_id::text,
    jsonb_build_object('campaign_id', p_campaign_id, 'overdue_warning_threshold', v_old),
    jsonb_build_object('campaign_id', p_campaign_id, 'overdue_warning_threshold', p_threshold),
    p_request_id);
end;
$$;

revoke all on function public.campaign_set_overdue_warning_threshold(uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.campaign_set_overdue_warning_threshold(uuid, integer, text) to authenticated;
comment on function public.campaign_set_overdue_warning_threshold(uuid, integer, text) is
  'SAN-142: sets N, the overdue installments from which reports warn about a sale (audited; campaign.update_rules).';

create function public.report_overdue_sales(
  p_campaign_id uuid,
  p_collector_id uuid default null,
  p_limit integer default null,
  p_offset integer default 0
) returns table (
  sale_id uuid, bond_id uuid, bond_label text, collector_id uuid, collector_name text,
  overdue_count bigint, overdue_amount text, oldest_due_date date, threshold integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_campaign public.campaigns;
begin
  perform public.report_require_operational(p_campaign_id);
  select * into v_campaign from public.campaigns where id = p_campaign_id;
  return query
  select s.id, s.bond_id, public.bond_label(s.bond_id, v_campaign.number_digits), s.collector_id,
    c.display_name, count(*), sum(i.amount)::numeric(14,2)::text, min(i.due_date),
    v_campaign.overdue_warning_threshold
  from public.sales s
  join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active'
  join public.installments i on i.payment_plan_id = pp.id
  join public.collectors c on c.id = s.collector_id
  where s.campaign_id = p_campaign_id and s.status = 'active' and s.uncollectible_at is null
    and (i.status = 'overdue' or (i.status = 'pending' and i.due_date < v_today))
    and (p_collector_id is null or s.collector_id = p_collector_id)
  group by s.id, s.bond_id, s.collector_id, c.display_name
  having count(*) >= v_campaign.overdue_warning_threshold
  order by count(*) desc, min(i.due_date), s.id
  -- Paged like the financial reports: PostgREST caps a response at 1000 rows.
  limit p_limit offset greatest(coalesce(p_offset, 0), 0);
end $$;

revoke all on function public.report_overdue_sales(uuid, uuid, integer, integer) from public, anon, service_role;
grant execute on function public.report_overdue_sales(uuid, uuid, integer, integer) to authenticated;
comment on function public.report_overdue_sales(uuid, uuid, integer, integer) is
  'SAN-142: active, unmarked sales with at least the campaign''s N overdue installments. Informative only.';
