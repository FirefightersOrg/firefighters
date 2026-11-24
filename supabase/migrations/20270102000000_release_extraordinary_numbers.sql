-- SAN-117: generated extraordinary draws may be annulled before freeze.
-- Reservations are campaign-wide, not owned by a draw. Keep every historical row.
drop index public.bond_numbers_one_extraordinary_per_base;
create unique index bond_numbers_one_extraordinary_per_base
  on public.bond_numbers(source_base_number_id)
  where number_kind = 'extraordinary' and source_base_number_id is not null and released_at is null;

create or replace function public.draws_guard_write() returns trigger
language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'scheduled' then
      raise exception 'draw must start scheduled' using errcode = '23514';
    end if;
  else
    if old.status in ('closed','annulled') then
      raise exception 'terminal draw is immutable' using errcode = '55000';
    end if;
    if (new.id,new.campaign_id,new.created_at,new.created_by) is distinct from
       (old.id,old.campaign_id,old.created_at,old.created_by) then
      raise exception 'draw identity is immutable' using errcode = '23001';
    end if;
    if new.status <> old.status and not (
      (old.status = 'scheduled' and new.status in ('roster_generated','annulled'))
      or (old.status = 'roster_generated' and new.status = 'roster_frozen')
      or (old.status = 'roster_generated' and new.status = 'annulled'
        and old.draw_type = 'extraordinary_full_payment'
        and not exists (select 1 from public.draw_rosters where draw_id = old.id and status = 'frozen'))
      or (old.status = 'roster_frozen' and new.status = 'completed')
      or (old.status = 'completed' and new.status = 'closed')
    ) then raise exception 'invalid draw transition' using errcode = '23514'; end if;
    if old.status <> 'scheduled' and
       (new.draw_type,new.name,new.draw_date,new.payment_cutoff_at,new.required_installment_number,new.eligibility_rule)
       is distinct from
       (old.draw_type,old.name,old.draw_date,old.payment_cutoff_at,old.required_installment_number,old.eligibility_rule) then
      raise exception 'only scheduled draw rules can change' using errcode = '55000';
    end if;
  end if;
  if tg_op = 'INSERT' or new.required_installment_number is distinct from old.required_installment_number then
    -- RPCs changing configuration lock campaign before draw.
    select installment_count into v_count from public.campaigns where id = new.campaign_id for share;
    if new.required_installment_number > v_count then
      raise exception 'required installment exceeds campaign count' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;

create or replace function public.bond_numbers_guard_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_bond public.bonds;
  v_campaign public.campaigns;
  v_source public.bond_numbers;
  v_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.campaign_id is distinct from old.campaign_id
      or new.bond_id is distinct from old.bond_id
      or new.number_value is distinct from old.number_value
      or new.number_kind is distinct from old.number_kind
      or new.source_base_number_id is distinct from old.source_base_number_id
      or new.created_at is distinct from old.created_at
    then
      raise exception 'bond_numbers.id, campaign_id, bond_id, number_value, number_kind, source_base_number_id and created_at cannot be changed'
        using errcode = 'restrict_violation';
    end if;
    if old.released_at is not null then
      raise exception 'bond number % was released and cannot be changed', old.id
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    if new.released_at is not null then
      -- The audited annul RPC holds campaign -> draw -> rosters -> seed-77 lock.
      -- This narrow exception does not relax release rules for ordinary numbers.
      if old.number_kind = 'extraordinary'
        and exists (select 1 from public.draw_roster_entries e
          join public.draw_rosters r on r.id = e.draw_roster_id
          join public.draws d on d.id = r.draw_id
          where e.bond_number_id = old.id and d.status = 'annulled'
            and d.draw_type = 'extraordinary_full_payment')
        and not exists (select 1 from public.draw_roster_entries e
          join public.draw_rosters r on r.id = e.draw_roster_id
          join public.draws d on d.id = r.draw_id
          where e.bond_number_id = old.id and d.status <> 'annulled') then
        new.released_at := now();
        return new;
      end if;
      select * into v_bond from public.bonds where id = new.bond_id;
      if v_bond.commercial_status <> 'annulled' then
        raise exception 'bond numbers can only be released once their bond is annulled (status: %)', v_bond.commercial_status
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      if v_bond.annulled_from_status is distinct from 'available' then
        raise exception 'bond numbers can only be released when their bond was annulled from available (annulled from: %)',
          v_bond.annulled_from_status using errcode = 'object_not_in_prerequisite_state';
      end if;
      new.released_at := now();
    end if;
    return new;
  end if;
  if new.released_at is not null or new.released_by is not null then
    raise exception 'new bond numbers cannot be released' using errcode = 'check_violation';
  end if;
  select * into v_bond from public.bonds where id = new.bond_id for no key update;
  if found and v_bond.campaign_id = new.campaign_id then
    if v_bond.origin = 'manual_grouping' then
      raise exception 'a manually grouped pata has no numbers of its own (its members keep theirs)'
        using errcode = 'check_violation';
    end if;
    if v_bond.commercial_status = 'annulled' then
      raise exception 'numbers cannot be added to annulled bond %', v_bond.id
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    select * into v_campaign from public.campaigns where id = v_bond.campaign_id;
    if new.number_value > v_campaign.max_number then
      raise exception 'number % exceeds the campaign maximum number (%)', new.number_value, v_campaign.max_number
        using errcode = 'check_violation';
    end if;
    if new.number_kind in ('base', 'associated') then
      select count(*) into v_count from public.bond_numbers n
        where n.bond_id = new.bond_id and n.number_kind = new.number_kind and n.released_at is null;
      if v_count >= v_bond.commercial_unit_count then
        raise exception 'bond % already has % % number(s) (commercial unit count %)',
          v_bond.id, v_count, new.number_kind, v_bond.commercial_unit_count using errcode = 'check_violation';
      end if;
    end if;
    if new.number_kind = 'associated' then
      select * into v_source from public.bond_numbers where id = new.source_base_number_id;
      if found and v_source.bond_id = new.bond_id then
        if v_source.number_kind <> 'base' then
          raise exception 'the source of an associated number must be a base number (got %)', v_source.number_kind
            using errcode = 'check_violation';
        end if;
        if new.number_value is distinct from v_source.number_value + v_campaign.associated_number_offset then
          raise exception 'associated number must be % (base % + offset %), got %',
            v_source.number_value + v_campaign.associated_number_offset, v_source.number_value,
            v_campaign.associated_number_offset, new.number_value using errcode = 'check_violation';
        end if;
      end if;
    end if;
  end if;
  new.created_at := now();
  return new;
end; $$;

create or replace function public.draw_annul(p_draw_id uuid,p_reason text,p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.bond_require_actor('draw.update');
  v_campaign uuid;
  v_old public.draws;
  v_new public.draws;
  v_released uuid[] := '{}';
begin
  if p_draw_id is null or p_reason is null or btrim(p_reason) = '' or char_length(btrim(p_reason)) > 1000 then
    raise exception 'draw id and reason (1..1000 characters) are required' using errcode = '22023';
  end if;
  select campaign_id into v_campaign from public.draws where id = p_draw_id;
  if not found then raise exception 'draw not found' using errcode = 'P0002'; end if;
  -- Match generation's parent-first order. No campaign status restriction on annulment.
  perform 1 from public.campaigns where id = v_campaign for share;
  select * into v_old from public.draws where id = p_draw_id for update;
  perform 1 from public.draw_rosters where draw_id = p_draw_id order by id for update;
  if (v_old.status <> 'scheduled' and not
      (v_old.status = 'roster_generated' and v_old.draw_type = 'extraordinary_full_payment'))
    or exists (select 1 from public.draw_rosters where draw_id = p_draw_id and status = 'frozen') then
    raise exception 'only scheduled or generated extraordinary draws can be annulled before freeze' using errcode = '55000';
  end if;
  if v_old.draw_type = 'extraordinary_full_payment' then
    -- Serialize reference creation/reuse and release across different draws.
    perform pg_advisory_xact_lock(hashtextextended(v_campaign::text,77));
  end if;
  update public.draws set status = 'annulled',annulled_at = now(),annulled_by = v_actor,
    annul_reason = btrim(p_reason) where id = p_draw_id returning * into v_new;
  if v_old.draw_type = 'extraordinary_full_payment' then
    with released as (
      update public.bond_numbers n set released_at = now(),released_by = v_actor
      where n.campaign_id = v_campaign and n.number_kind = 'extraordinary' and n.released_at is null
        and exists (select 1 from public.draw_roster_entries e join public.draw_rosters r on r.id = e.draw_roster_id
          where e.bond_number_id = n.id and r.draw_id = p_draw_id)
        and not exists (select 1 from public.draw_roster_entries e
          join public.draw_rosters r on r.id = e.draw_roster_id join public.draws d on d.id = r.draw_id
          where e.bond_number_id = n.id and d.status <> 'annulled')
      returning n.id
    ) select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_released from released;
  end if;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,reason,request_id)
    values(v_actor,'draw.annul','draw',p_draw_id,to_jsonb(v_old),
      to_jsonb(v_new) || jsonb_build_object('released_number_ids',v_released),btrim(p_reason),p_request_id);
end $$;
revoke all on function public.draw_annul(uuid,text,text) from public,anon,service_role;
grant execute on function public.draw_annul(uuid,text,text) to authenticated;

-- SAN-81 generation preserved; only the two reservation lookups become release-aware.
create or replace function public.draw_generate_roster(p_draw_id uuid, p_request_id text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.bond_require_actor('draw.generate_roster');
  v_campaign uuid;
  v_draw_type text;
  v_max integer;
  v_campaign_status text;
  v_draw public.draws;
  v_roster uuid;
  v_snapshot jsonb;
  v_sources jsonb;
  v_values integer[];
  v_source record;
  v_position integer := 0;
  v_required integer;
begin
  if p_draw_id is null then
    raise exception 'draw id is required' using errcode = '22023';
  end if;
  select campaign_id,draw_type into v_campaign,v_draw_type from public.draws where id = p_draw_id;
  if not found then raise exception 'draw not found' using errcode = 'P0002'; end if;
  if v_draw_type = 'consolation' then
    select max_number,status into v_max,v_campaign_status
      from public.campaigns where id = v_campaign for update;
  else
    select max_number,status into v_max,v_campaign_status
      from public.campaigns where id = v_campaign for share;
  end if;
  if v_campaign_status not in ('draft','active') then
    raise exception 'draws require a draft or active campaign' using errcode = '55000';
  end if;
  select * into v_draw from public.draws where id = p_draw_id for update;
  perform public.draw_require_resolved_prizes(v_draw);
  perform 1 from public.draw_rosters where draw_id = p_draw_id order by id for update;
  if v_draw.status not in ('scheduled','roster_generated')
    or exists (select 1 from public.draw_rosters where draw_id = p_draw_id and status = 'frozen') then
    raise exception 'draw roster cannot be generated in this state' using errcode = '55000';
  end if;
  v_required := case when v_draw.draw_type = 'consolation' then
    public.draw_consolation_required(v_draw.required_installment_number,v_draw.eligibility_rule)
    else v_draw.required_installment_number end;
  if v_draw.draw_type = 'extraordinary_full_payment' then
    perform pg_advisory_xact_lock(hashtextextended(v_campaign::text,77));
  end if;
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
      exists(select 1 from public.prize_awards a
        join public.prizes pr on pr.id = a.prize_id
        join public.draws prior on prior.id = pr.draw_id
        left join public.bond_groups wg on wg.member_bond_id = a.bond_id and wg.ungrouped_at is null
        where a.status in ('awarded','delivered') and pr.status <> 'annulled'
          and pr.excludes_from_consolation and prior.campaign_id = v_campaign and prior.status <> 'annulled'
          and (prior.draw_date,prior.created_at,prior.id) < (v_draw.draw_date,v_draw.created_at,v_draw.id)
          and coalesce(wg.pata_bond_id,a.bond_id) = p.effective_bond_id) as already_won,
      (select count(*) > 0 and bool_and(coalesce((
          select sum(pi.amount_applied)
          from public.payment_installments pi join public.payments pay on pay.id = pi.payment_id
          where pi.installment_id = i.id
            and public.draw_payment_before_cutoff(pay.status,pay.payment_date,v_draw.payment_cutoff_at)
        ),0) >= i.amount)
        from public.installments i where i.payment_plan_id = pp.id) as fully_paid,
      (select count(*) = v_required and bool_and(coalesce((
          select sum(pi.amount_applied)
          from public.payment_installments pi join public.payments pay on pay.id = pi.payment_id
          where pi.installment_id = i.id
            and public.draw_payment_before_cutoff(pay.status,pay.payment_date,v_draw.payment_cutoff_at)
        ),0) >= i.amount)
        from public.installments i where i.payment_plan_id = pp.id
          and i.installment_number <= v_required) as up_to_date
    from participants p join public.bonds b on b.id = p.effective_bond_id
    left join public.sales s on s.bond_id = b.id and s.status = 'active'
    left join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active'
    left join public.buyers byr on byr.id = coalesce(s.buyer_id,b.current_buyer_id)
    left join public.collectors c on c.id = coalesce(s.collector_id,b.current_collector_id)
  ), evaluated as (
    select *,case
      when annulled_at is not null or commercial_status = 'annulled' then 'annulled'
      when commercial_status <> 'sold' then 'not_sold'
      when v_draw.draw_type = 'consolation' and already_won then 'already_won'
      when v_draw.draw_type = 'consolation' and v_required is null then 'missing_required_installment'
      when v_draw.draw_type in ('monthly','consolation') and not coalesce(up_to_date,false) then 'installments_not_covered'
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
      where e.source_base_number_id = q.id and e.number_kind = 'extraordinary' and e.released_at is null);
    select coalesce(array_agg(value order by value),'{}'::integer[]) into v_values
    from (
      select value from generate_series(0,v_max) value
      where not exists (select 1 from public.bond_numbers n
        where n.campaign_id = v_campaign and n.number_value = value and n.released_at is null)
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
revoke all on function public.draw_generate_roster(uuid,text) from public,anon,service_role;
grant execute on function public.draw_generate_roster(uuid,text) to authenticated;
revoke all on function public.draws_guard_write(),public.bond_numbers_guard_write()
  from public,anon,authenticated,service_role;
