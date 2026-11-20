-- SAN-77: trusted, transactional roster snapshots. No client-supplied entries.
create function public.draw_payment_before_cutoff(p_status text, p_date date, p_cutoff timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select p_status = 'confirmed'
    and p_date <= (p_cutoff at time zone 'America/Argentina/Buenos_Aires')::date;
$$;
revoke all on function public.draw_payment_before_cutoff(text,date,timestamptz)
  from public,anon,authenticated,service_role;

-- Same precedence as SAN-76; invalid legacy configuration has a stable null result.
create function public.draw_consolation_required(p_required integer,p_rule jsonb)
returns integer language plpgsql immutable set search_path = '' as $$
declare v jsonb := coalesce(nullif(p_rule->'requiredInstallmentNumber','null'::jsonb),
  nullif(p_rule->'required_installment_number','null'::jsonb),to_jsonb(p_required));
begin
  if jsonb_typeof(v) = 'number' then
    if v::numeric between 1 and 2147483647 and trunc(v::numeric) = v::numeric then
      return v::integer;
    end if;
  end if;
  return null;
end $$;
revoke all on function public.draw_consolation_required(integer,jsonb)
  from public,anon,authenticated,service_role;

-- Extras are campaign-wide, immutable reservations, reusable by subsequent draws.
create unique index bond_numbers_one_extraordinary_per_base
  on public.bond_numbers(source_base_number_id)
  where number_kind = 'extraordinary' and source_base_number_id is not null;

create function public.draw_generate_roster(p_draw_id uuid, p_request_id text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.bond_require_actor('draw.generate_roster');
  v_campaign uuid;
  v_max integer;
  v_campaign_status text;
  v_draw public.draws;
  v_roster uuid;
  v_snapshot jsonb;
  v_sources jsonb;
  v_values integer[];
  v_source record;
  v_position integer := 0;
begin
  if p_draw_id is null then
    raise exception 'draw id is required' using errcode = '22023';
  end if;
  -- Discover parent without locking, then acquire the documented parent-first order.
  select campaign_id into v_campaign from public.draws where id = p_draw_id;
  if not found then raise exception 'draw not found' using errcode = 'P0002'; end if;
  select max_number,status into v_max,v_campaign_status
    from public.campaigns where id = v_campaign for share;
  if v_campaign_status not in ('draft','active') then
    raise exception 'draws require a draft or active campaign' using errcode = '55000';
  end if;
  select * into v_draw from public.draws where id = p_draw_id for update;
  perform 1 from public.draw_rosters where draw_id = p_draw_id order by id for update;
  if v_draw.status not in ('scheduled','roster_generated')
    or exists (select 1 from public.draw_rosters where draw_id = p_draw_id and status = 'frozen') then
    raise exception 'draw roster cannot be generated in this state' using errcode = '55000';
  end if;
  if v_draw.draw_type = 'consolation' then
    raise exception 'consolation rosters require draw results (Phase 12): not available yet'
      using errcode = '55000';
  end if;
  if v_draw.draw_type = 'extraordinary_full_payment' then
    -- Same-campaign extraordinary draws cannot allocate the same free value.
    -- This is not a financial lock; no settlement/payment/installment locks are taken.
    perform pg_advisory_xact_lock(hashtextextended(v_campaign::text,77));
  end if;

  -- ONE statement snapshot for commercial state, parties, plan and confirmed coverage.
  -- A manual pata's member retains number ownership; its active parent supplies sale/rules.
  with participants as (
    select b.id as physical_bond_id, coalesce(g.pata_bond_id,b.id) as effective_bond_id
    from public.bonds b left join public.bond_groups g
      on g.member_bond_id = b.id and g.ungrouped_at is null
    where b.campaign_id = v_campaign and b.origin <> 'manual_grouping'
  ), coverage as (
    select p.physical_bond_id,b.id,b.kind,b.commercial_status,b.annulled_at,
      coalesce(jsonb_build_object('id',byr.id,'first_name',byr.first_name,
        'last_name',byr.last_name,'business_name',byr.business_name,
        'document_number',byr.document_number,'tax_id',byr.tax_id),'{}'::jsonb) as buyer,
      jsonb_build_object('id',c.id,'display_name',c.display_name,
        'user_profile_id',c.user_profile_id) as collector,
      (select count(*) > 0 and bool_and(coalesce((
          select sum(pi.amount_applied)
          from public.payment_installments pi join public.payments pay on pay.id = pi.payment_id
          where pi.installment_id = i.id
            and public.draw_payment_before_cutoff(pay.status,pay.payment_date,v_draw.payment_cutoff_at)
        ),0) >= i.amount)
        from public.installments i where i.payment_plan_id = pp.id) as fully_paid,
      (select count(*) = v_draw.required_installment_number and bool_and(coalesce((
          select sum(pi.amount_applied)
          from public.payment_installments pi join public.payments pay on pay.id = pi.payment_id
          where pi.installment_id = i.id
            and public.draw_payment_before_cutoff(pay.status,pay.payment_date,v_draw.payment_cutoff_at)
        ),0) >= i.amount)
        from public.installments i where i.payment_plan_id = pp.id
          and i.installment_number <= v_draw.required_installment_number) as up_to_date
    from participants p join public.bonds b on b.id = p.effective_bond_id
    left join public.sales s on s.bond_id = b.id and s.status = 'active'
    left join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active'
    left join public.buyers byr on byr.id = coalesce(s.buyer_id,b.current_buyer_id)
    left join public.collectors c on c.id = coalesce(s.collector_id,b.current_collector_id)
  ), evaluated as (
    select *,case
      when annulled_at is not null or commercial_status = 'annulled' then 'annulled'
      when commercial_status <> 'sold' then 'not_sold'
      when v_draw.draw_type = 'consolation'
        and public.draw_consolation_required(v_draw.required_installment_number,v_draw.eligibility_rule) is null
        then 'missing_required_installment'
      when v_draw.draw_type = 'monthly' and not coalesce(up_to_date,false) then 'installments_not_covered'
      when v_draw.draw_type in ('final','extraordinary_full_payment') and not coalesce(fully_paid,false) then 'not_fully_paid'
      else null end as reason
    from coverage
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'bond_id',physical_bond_id,'effective_bond_id',id,'kind',kind,
    'buyer',buyer,'collector',collector,'reason',reason) order by physical_bond_id),'[]')
    into v_snapshot from evaluated;

  if v_draw.draw_type = 'extraordinary_full_payment' then
    select coalesce(jsonb_agg(jsonb_build_object('bond_id',q.bond_id,'id',q.id)
      order by q.lowest,q.effective_bond_id,q.number_value,q.id),'[]')
    into v_sources
    from (
      select n.*,x.effective_bond_id,
        min(n.number_value) over (partition by x.effective_bond_id) as lowest
      from jsonb_to_recordset(v_snapshot) as x(bond_id uuid,effective_bond_id uuid,reason text)
      join public.bond_numbers n on n.bond_id = x.bond_id
      where x.reason is null and n.number_kind = 'base' and n.released_at is null
    ) q
    where not exists (select 1 from public.bond_numbers e
      where e.source_base_number_id = q.id and e.number_kind = 'extraordinary');
    select coalesce(array_agg(value order by value),'{}'::integer[]) into v_values
    from (
      select value from generate_series(0,v_max) value
      where not exists (select 1 from public.bond_numbers n
        where n.campaign_id = v_campaign and n.number_value = value)
      order by value limit jsonb_array_length(v_sources)
    ) free;
    if cardinality(v_values) < jsonb_array_length(v_sources) then
      raise exception 'not enough free campaign numbers' using errcode = '55000';
    end if;
    for v_source in
      select (s.value->>'bond_id')::uuid as bond_id,(s.value->>'id')::uuid as id
      from jsonb_array_elements(v_sources) with ordinality s(value,position)
      order by s.position
    loop
      v_position := v_position + 1;
      begin
        insert into public.bond_numbers(campaign_id,bond_id,number_value,number_kind,source_base_number_id)
          values(v_campaign,v_source.bond_id,v_values[v_position],'extraordinary',v_source.id);
      exception when unique_violation then
        -- Ordinary creation may reserve a free value; the raised error rolls back everything.
        raise exception 'number allocation changed concurrently; retry generation' using errcode = '55000';
      end;
    end loop;
  end if;

  update public.draw_rosters set status = 'superseded'
    where draw_id = p_draw_id and status = 'generated';
  insert into public.draw_rosters(draw_id,generated_by,created_by)
    values(p_draw_id,v_actor,v_actor) returning id into v_roster;
  insert into public.draw_roster_entries(draw_roster_id,bond_id,bond_number_id,number_value,
    buyer_snapshot,collector_snapshot,eligible,ineligibility_reason,created_by)
  select v_roster,n.bond_id,n.id,n.number_value,x.buyer,x.collector,x.reason is null,x.reason,v_actor
    from jsonb_to_recordset(v_snapshot) as x(bond_id uuid,buyer jsonb,collector jsonb,reason text)
    join public.bond_numbers n on n.bond_id = x.bond_id
    where n.released_at is null and (n.number_kind <> 'extraordinary'
      or v_draw.draw_type = 'extraordinary_full_payment');
  update public.draws set status = 'roster_generated' where id = p_draw_id;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,new_value,request_id)
    values(v_actor,'draw.generate_roster','draw_roster',v_roster,
      jsonb_build_object('draw_id',p_draw_id,'campaign_id',v_campaign,'roster_id',v_roster),p_request_id);
  return v_roster;
end $$;

create function public.draw_freeze_roster(p_draw_id uuid, p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.bond_require_actor('draw.freeze_roster');
  v_draw public.draws;
  v_roster public.draw_rosters;
begin
  if p_draw_id is null then raise exception 'draw id is required' using errcode = '22023'; end if;
  select * into v_draw from public.draws where id = p_draw_id for update;
  if not found then raise exception 'draw not found' using errcode = 'P0002'; end if;
  -- Idempotent (Santiago's decision on #79): freezing an already frozen roster is a no-op
  -- success. Nothing changes and no audit row is written.
  if v_draw.status = 'roster_frozen'
    and exists (select 1 from public.draw_rosters where draw_id = p_draw_id and status = 'frozen') then
    return;
  end if;
  if v_draw.status <> 'roster_generated' then
    raise exception 'draw must have a generated roster' using errcode = '55000';
  end if;
  select * into v_roster from public.draw_rosters
    where draw_id = p_draw_id and status = 'generated' for update;
  if not found then raise exception 'generated roster not found' using errcode = '55000'; end if;
  update public.draw_rosters set status = 'frozen',frozen_at = now(),frozen_by = v_actor
    where id = v_roster.id;
  update public.draws set status = 'roster_frozen' where id = p_draw_id;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,request_id)
    values(v_actor,'draw.freeze_roster','draw_roster',v_roster.id,
      to_jsonb(v_roster),jsonb_build_object('draw_id',p_draw_id,'campaign_id',v_draw.campaign_id,
        'roster_id',v_roster.id,'status','frozen','frozen_by',v_actor,'frozen_at',now()),p_request_id);
  return;
end $$;
revoke all on function public.draw_generate_roster(uuid,text),public.draw_freeze_roster(uuid,text)
  from public,anon,service_role;
grant execute on function public.draw_generate_roster(uuid,text),public.draw_freeze_roster(uuid,text)
  to authenticated;

create function public.draw_validate_input(
  p_type text,p_name text,p_date date,p_cutoff timestamptz,p_required integer,p_rule jsonb
) returns void language plpgsql set search_path = '' as $$
begin
  if p_type is null or p_type not in ('monthly','extraordinary_full_payment','final','consolation')
    or p_name is null or btrim(p_name) = '' or char_length(btrim(p_name)) > 200
    or p_date is null or p_cutoff is null
    or (p_required is not null and p_required < 1)
    or (p_type = 'monthly' and p_required is null)
    or p_rule is null or jsonb_typeof(p_rule) <> 'object' then
    raise exception 'invalid draw data' using errcode = '22023';
  end if;
  if p_type = 'consolation' and public.draw_consolation_required(p_required,p_rule) is null then
    raise exception 'consolation draw requires a positive required installment in required_installment_number or eligibility_rule'
      using errcode = '22023';
  end if;
end $$;
revoke all on function public.draw_validate_input(text,text,date,timestamptz,integer,jsonb)
  from public,anon,authenticated,service_role;

create function public.draw_create(
  p_campaign_id uuid,p_draw_type text,p_name text,p_draw_date date,
  p_payment_cutoff_at timestamptz,p_required_installment_number integer,
  p_eligibility_rule jsonb,p_request_id text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.bond_require_actor('draw.create');
  v_campaign public.campaigns;
  v_draw public.draws;
begin
  perform public.draw_validate_input(p_draw_type,p_name,p_draw_date,p_payment_cutoff_at,
    p_required_installment_number,p_eligibility_rule);
  if p_campaign_id is null then raise exception 'campaign id is required' using errcode = '22023'; end if;
  select * into v_campaign from public.campaigns where id = p_campaign_id for share;
  if not found then raise exception 'campaign not found' using errcode = 'P0002'; end if;
  if v_campaign.status not in ('draft','active') then
    raise exception 'draws require a draft or active campaign' using errcode = '55000';
  end if;
  insert into public.draws(campaign_id,draw_type,name,draw_date,payment_cutoff_at,
    required_installment_number,eligibility_rule,created_by)
    values(p_campaign_id,p_draw_type,btrim(p_name),p_draw_date,p_payment_cutoff_at,
      p_required_installment_number,p_eligibility_rule,v_actor) returning * into v_draw;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,new_value,request_id)
    values(v_actor,'draw.create','draw',v_draw.id,to_jsonb(v_draw),p_request_id);
  return v_draw.id;
end $$;

create function public.draw_update(
  p_draw_id uuid,p_name text,p_draw_date date,p_payment_cutoff_at timestamptz,
  p_required_installment_number integer,p_eligibility_rule jsonb,p_request_id text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.bond_require_actor('draw.update');
  v_campaign uuid;
  v_campaign_status text;
  v_old public.draws;
  v_new public.draws;
begin
  if p_draw_id is null then raise exception 'draw id is required' using errcode = '22023'; end if;
  select campaign_id into v_campaign from public.draws where id = p_draw_id;
  if not found then raise exception 'draw not found' using errcode = 'P0002'; end if;
  -- Changing required installment invokes SAN-75's campaign count guard: parent first.
  select status into v_campaign_status from public.campaigns where id = v_campaign for share;
  if v_campaign_status not in ('draft','active') then
    raise exception 'draws require a draft or active campaign' using errcode = '55000';
  end if;
  select * into v_old from public.draws where id = p_draw_id for update;
  if v_old.status <> 'scheduled' then
    raise exception 'only scheduled draws can be edited' using errcode = '55000';
  end if;
  perform public.draw_validate_input(v_old.draw_type,p_name,p_draw_date,p_payment_cutoff_at,
    p_required_installment_number,p_eligibility_rule);
  update public.draws set name = btrim(p_name),draw_date = p_draw_date,
    payment_cutoff_at = p_payment_cutoff_at,required_installment_number = p_required_installment_number,
    eligibility_rule = p_eligibility_rule where id = p_draw_id returning * into v_new;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,request_id)
    values(v_actor,'draw.update','draw',p_draw_id,to_jsonb(v_old),to_jsonb(v_new),p_request_id);
end $$;

create function public.draw_annul(p_draw_id uuid,p_reason text,p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.bond_require_actor('draw.update');
  v_old public.draws;
  v_new public.draws;
begin
  if p_draw_id is null or p_reason is null or btrim(p_reason) = '' or char_length(btrim(p_reason)) > 1000 then
    raise exception 'draw id and reason (1..1000 characters) are required' using errcode = '22023';
  end if;
  select * into v_old from public.draws where id = p_draw_id for update;
  if not found then raise exception 'draw not found' using errcode = 'P0002'; end if;
  if v_old.status <> 'scheduled' then
    raise exception 'only scheduled draws can be annulled' using errcode = '55000';
  end if;
  update public.draws set status = 'annulled',annulled_at = now(),annulled_by = v_actor,
    annul_reason = btrim(p_reason) where id = p_draw_id returning * into v_new;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,reason,request_id)
    values(v_actor,'draw.annul','draw',p_draw_id,to_jsonb(v_old),to_jsonb(v_new),btrim(p_reason),p_request_id);
end $$;
revoke all on function
  public.draw_create(uuid,text,text,date,timestamptz,integer,jsonb,text),
  public.draw_update(uuid,text,date,timestamptz,integer,jsonb,text),public.draw_annul(uuid,text,text)
  from public,anon,service_role;
grant execute on function
  public.draw_create(uuid,text,text,date,timestamptz,integer,jsonb,text),
  public.draw_update(uuid,text,date,timestamptz,integer,jsonb,text),public.draw_annul(uuid,text,text)
  to authenticated;
