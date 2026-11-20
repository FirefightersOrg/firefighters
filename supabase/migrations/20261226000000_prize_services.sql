-- SAN-81. Corrections retain the immutable winning-number snapshot and replace the
-- prize (including its position). A void result is identified by its annulled parent.
insert into public.permissions(code,description)
values ('prize.annul','Annul an undelivered prize.');
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.name = 'admin' and p.code = 'prize.annul';
alter table public.prizes drop constraint prizes_draw_id_position_key;
create unique index prizes_active_position on public.prizes(draw_id,position) where status <> 'annulled';
create index prizes_draw_idx on public.prizes(draw_id);

-- A separate correction trigger admits ONLY annulment, preserving every original
-- field. The original SAN-80 guards still handle every ordinary write.
-- Trigger functions cannot delegate; keep the original triggers and skip them only
-- for the narrowly marked correction. API roles have no DML, even with a forged GUC.
drop trigger prizes_guard_write on public.prizes;
drop trigger prize_awards_guard_write on public.prize_awards;
create trigger prizes_guard_write before insert or update on public.prizes
  for each row when (current_setting('app.prize_annul',true) is distinct from 'on')
  execute function public.prizes_guard_write();
create trigger prize_awards_guard_write before insert or update on public.prize_awards
  for each row when (current_setting('app.prize_annul',true) is distinct from 'on')
  execute function public.prize_awards_guard_write();

alter table public.prize_awards drop constraint prize_awards_delivery_consistent;
alter table public.prize_awards add constraint prize_awards_delivery_consistent check (
  (status = 'delivered' and delivered_at is not null and delivered_by is not null and notes is not null)
  or (status = 'awarded' and delivered_at is null and delivered_by is null)
  or (status = 'annulled' and (
    (delivered_at is null and delivered_by is null)
    or (delivered_at is not null and delivered_by is not null and notes is not null)))
);
create function public.prize_guard_annul() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('app.prize_annul',true) = 'on' then
    if tg_op <> 'UPDATE' then
      raise exception 'annulment cannot insert history' using errcode = '55000';
    end if;
    if old.status = 'annulled' or new.status <> 'annulled'
      or (to_jsonb(new) - array['status','annulled_at','annulled_by','annul_reason','updated_at'])
        is distinct from
        (to_jsonb(old) - array['status','annulled_at','annulled_by','annul_reason','updated_at']) then
      raise exception 'annulment must preserve original history' using errcode = '55000';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger prizes_guard_annul before insert or update on public.prizes
  for each row execute function public.prize_guard_annul();
create trigger prize_awards_guard_annul before insert or update on public.prize_awards
  for each row execute function public.prize_guard_annul();
revoke all on function public.prize_guard_annul() from public,anon,authenticated,service_role;

-- Serialize all operations on a draw, parents first. Discovery is intentionally
-- unlocked; parent identities cannot change. No financial locks are acquired.
create function public.prize_lock_draw(p_draw_id uuid) returns public.draws
language plpgsql set search_path = '' as $$
declare c uuid; d public.draws;
begin
  if p_draw_id is null then raise exception 'draw id required' using errcode = '22023'; end if;
  select campaign_id into c from public.draws where id = p_draw_id;
  if not found then raise exception 'draw not found' using errcode = 'P0002'; end if;
  perform 1 from public.campaigns where id = c for share;
  select * into d from public.draws where id = p_draw_id for update;
  if d.status in ('closed','annulled') then
    raise exception 'draw is closed or annulled' using errcode = '55000';
  end if;
  return d;
end $$;
create function public.prize_lock(p_prize_id uuid) returns public.prizes
language plpgsql set search_path = '' as $$
declare d uuid; p public.prizes;
begin
  if p_prize_id is null then raise exception 'prize id required' using errcode = '22023'; end if;
  select draw_id into d from public.prizes where id = p_prize_id;
  if not found then raise exception 'prize not found' using errcode = 'P0002'; end if;
  perform public.prize_lock_draw(d);
  select * into p from public.prizes where id = p_prize_id for update;
  perform 1 from public.winning_numbers where prize_id = p_prize_id order by id for update;
  perform 1 from public.prize_awards where prize_id = p_prize_id order by id for update;
  return p;
end $$;
create function public.prize_validate_text(p_value text,p_max integer,p_required boolean)
returns void language plpgsql set search_path = '' as $$
begin
  if (p_required and p_value is null)
    or (p_value is not null and (btrim(p_value) = '' or char_length(btrim(p_value)) > p_max)) then
    raise exception 'invalid prize text' using errcode = '22023';
  end if;
end $$;
create function public.prize_audit(p_actor uuid,p_action text,p_old public.prizes,
  p_new public.prizes,p_request text,p_reason text default null)
returns void language sql set search_path = '' as $$
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,reason,request_id)
  select p_actor,p_action,'prize',p_new.id,to_jsonb(p_old),
    to_jsonb(p_new) || jsonb_build_object('campaign_id',d.campaign_id,
      'winning_number',(select to_jsonb(w) from public.winning_numbers w where w.prize_id = p_new.id),
      'awards',coalesce((select jsonb_agg(to_jsonb(a) order by a.id)
        from public.prize_awards a where a.prize_id = p_new.id),'[]'::jsonb)),
    p_reason,p_request from public.draws d where d.id = p_new.draw_id;
$$;
revoke all on function public.prize_lock_draw(uuid),public.prize_lock(uuid),
  public.prize_validate_text(text,integer,boolean),
  public.prize_audit(uuid,text,public.prizes,public.prizes,text,text)
  from public,anon,authenticated,service_role;

create function public.prize_create(p_draw_id uuid,p_name text,p_description text,p_position integer,
  p_excludes_from_consolation boolean default true,p_request_id text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.bond_require_actor('draw.update'); p public.prizes;
begin
  if (public.prize_lock_draw(p_draw_id)).status = 'completed' then
    raise exception 'completed draws cannot configure prizes' using errcode = '55000';
  end if;
  perform public.prize_validate_text(p_name,200,true);
  perform public.prize_validate_text(p_description,1000,false);
  if p_position is null or p_position < 1 or p_excludes_from_consolation is null then
    raise exception 'invalid prize configuration' using errcode = '22023';
  end if;
  insert into public.prizes(draw_id,name,description,position,excludes_from_consolation,created_by)
    values(p_draw_id,btrim(p_name),btrim(p_description),p_position,p_excludes_from_consolation,actor)
    returning * into p;
  perform public.prize_audit(actor,'prize.create',null,p,p_request_id);
  return p.id;
end $$;
create function public.prize_update(p_prize_id uuid,p_name text,p_description text,p_position integer,
  p_excludes_from_consolation boolean,p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.bond_require_actor('draw.update'); old_p public.prizes; p public.prizes;
begin
  old_p := public.prize_lock(p_prize_id);
  if (select status from public.draws where id = old_p.draw_id) = 'completed' then
    raise exception 'completed draws cannot configure prizes' using errcode = '55000';
  end if;
  if old_p.status <> 'pending_validation' then
    raise exception 'only pending prizes can be edited' using errcode = '55000';
  end if;
  perform public.prize_validate_text(p_name,200,true);
  perform public.prize_validate_text(p_description,1000,false);
  if p_position is null or p_position < 1 or p_excludes_from_consolation is null then
    raise exception 'invalid prize configuration' using errcode = '22023';
  end if;
  update public.prizes set name = btrim(p_name),description = btrim(p_description),
    position = p_position,excludes_from_consolation = p_excludes_from_consolation
    where id = p_prize_id returning * into p;
  perform public.prize_audit(actor,'prize.update',old_p,p,p_request_id);
end $$;
create function public.draw_load_winning_number(p_prize_id uuid,p_number_value integer,p_notes text,
  p_request_id text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.bond_require_actor('draw.load_winner');
  old_p public.prizes; p public.prizes; e public.draw_roster_entries; w uuid; result text; maximum integer;
begin
  old_p := public.prize_lock(p_prize_id);
  if exists(select 1 from public.winning_numbers where prize_id = p_prize_id) then
    raise exception 'this prize already has a loaded winning number' using errcode = '55000';
  end if;
  if old_p.status <> 'pending_validation'
    or (select status from public.draws where id = old_p.draw_id) <> 'roster_frozen' then
    raise exception 'winning numbers require a pending prize and frozen draw' using errcode = '55000';
  end if;
  perform public.prize_validate_text(p_notes,1000,false);
  select c.max_number into maximum from public.campaigns c
    join public.draws d on d.campaign_id = c.id where d.id = old_p.draw_id;
  if p_number_value is null or p_number_value < 0 or p_number_value > maximum then
    raise exception 'number outside campaign range' using errcode = '22023';
  end if;
  if not exists(select 1 from public.draw_rosters where draw_id = old_p.draw_id and status = 'frozen') then
    raise exception 'frozen roster required' using errcode = '55000';
  end if;
  select en.* into e from public.draw_roster_entries en
    join public.draw_rosters r on r.id = en.draw_roster_id
    where r.draw_id = old_p.draw_id and r.status = 'frozen' and en.number_value = p_number_value;
  result := case when e.id is null then 'no_match' when e.eligible then 'eligible_winner' else 'not_eligible' end;
  insert into public.winning_numbers(draw_id,prize_id,number_value,matched_roster_entry_id,
    result_status,loaded_by,created_by,notes)
    values(old_p.draw_id,p_prize_id,p_number_value,e.id,result,actor,actor,btrim(p_notes)) returning id into w;
  p := old_p;
  if result <> 'eligible_winner' then
    update public.prizes set status = 'unawarded' where id = p_prize_id returning * into p;
  end if;
  perform public.prize_audit(actor,'draw.load_winner',old_p,p,p_request_id);
  return w;
end $$;
create function public.prize_resolve(p_prize_id uuid,p_decision text,p_notes text,p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.bond_require_actor('prize.resolve');
  old_p public.prizes; p public.prizes; w public.winning_numbers; e public.draw_roster_entries;
begin
  old_p := public.prize_lock(p_prize_id);
  if old_p.status <> 'pending_validation' then
    raise exception 'prize must be pending validation' using errcode = '55000';
  end if;
  if p_decision is null or p_decision not in ('award','unaward') then
    raise exception 'invalid prize decision' using errcode = '22023';
  end if;
  perform public.prize_validate_text(p_notes,1000,false);
  select * into w from public.winning_numbers where prize_id = p_prize_id;
  if not found or w.result_status <> 'eligible_winner' then
    raise exception 'eligible loaded result required' using errcode = '55000';
  end if;
  if p_decision = 'award' then
    select * into e from public.draw_roster_entries where id = w.matched_roster_entry_id;
    if e.buyer_snapshot->>'id' is null or e.collector_snapshot->>'id' is null then
      raise exception 'frozen parties required' using errcode = '55000';
    end if;
    update public.prizes set status = 'awarded' where id = p_prize_id;
    insert into public.prize_awards(prize_id,winning_number_id,bond_id,buyer_id,collector_id,notes,created_by)
      values(p_prize_id,w.id,e.bond_id,(e.buyer_snapshot->>'id')::uuid,
        (e.collector_snapshot->>'id')::uuid,btrim(p_notes),actor);
    update public.prizes set status = 'pending_delivery' where id = p_prize_id returning * into p;
  else
    update public.prizes set status = 'unawarded' where id = p_prize_id returning * into p;
  end if;
  perform public.prize_audit(actor,'prize.resolve',old_p,p,p_request_id,btrim(p_notes));
end $$;
create function public.prize_deliver(p_prize_id uuid,p_notes text,p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.bond_require_actor('prize.deliver'); old_p public.prizes; p public.prizes;
begin
  old_p := public.prize_lock(p_prize_id);
  if old_p.status <> 'pending_delivery' then
    raise exception 'prize must be pending delivery' using errcode = '55000';
  end if;
  perform public.prize_validate_text(p_notes,1000,true);
  update public.prize_awards set status = 'delivered',delivered_at = now(),delivered_by = actor,
    notes = btrim(p_notes) where prize_id = p_prize_id and status = 'awarded';
  if not found then raise exception 'active award required' using errcode = '55000'; end if;
  update public.prizes set status = 'delivered' where id = p_prize_id returning * into p;
  perform public.prize_audit(actor,'prize.deliver',old_p,p,p_request_id);
end $$;
create function public.prize_annul(p_prize_id uuid,p_reason text,p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.bond_require_actor('prize.annul'); old_p public.prizes; p public.prizes;
  previous_flag text := current_setting('app.prize_annul',true);
  previous_snapshot jsonb; next_snapshot jsonb; campaign uuid;
begin
  old_p := public.prize_lock(p_prize_id);
  if old_p.status = 'delivered' then
    raise exception 'a delivered prize cannot be annulled; pending product decision' using errcode = '55000';
  end if;
  if old_p.status not in ('pending_validation','awarded','pending_delivery','unawarded') then
    raise exception 'prize already annulled' using errcode = '55000';
  end if;
  perform public.prize_validate_text(p_reason,1000,true);
  select campaign_id into campaign from public.draws where id = old_p.draw_id;
  previous_snapshot := jsonb_build_object('prize',to_jsonb(old_p),
    'winning_number',(select to_jsonb(w) from public.winning_numbers w where prize_id = p_prize_id),
    'awards',coalesce((select jsonb_agg(to_jsonb(a) order by id) from public.prize_awards a
      where prize_id = p_prize_id),'[]'::jsonb));
  perform set_config('app.prize_annul','on',true);
  update public.prizes set status = 'annulled',annulled_at = now(),annulled_by = actor,
    annul_reason = btrim(p_reason) where id = p_prize_id returning * into p;
  update public.prize_awards set status = 'annulled',annulled_at = now(),annulled_by = actor,
    annul_reason = btrim(p_reason) where prize_id = p_prize_id and status <> 'annulled';
  perform set_config('app.prize_annul',coalesce(previous_flag,''),true);
  next_snapshot := jsonb_build_object('prize',to_jsonb(p),
    'winning_number',(select to_jsonb(w) from public.winning_numbers w where prize_id = p_prize_id),
    'awards',coalesce((select jsonb_agg(to_jsonb(a) order by id) from public.prize_awards a
      where prize_id = p_prize_id),'[]'::jsonb));
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,reason,request_id)
    values(actor,'prize.annul','prize',p_prize_id,previous_snapshot,
      jsonb_build_object('campaign_id',campaign,'correction_type','prize_annul',
        'affected_entity',jsonb_build_object('type','prize','id',p_prize_id),
        'related_entity',jsonb_build_object('type','draw','id',p.draw_id),
        'reason',btrim(p_reason),'user',actor,'date',now(),
        'previous_value',previous_snapshot,'new_value',next_snapshot,
        'generated_compensatory_movements','[]'::jsonb),btrim(p_reason),p_request_id);
end $$;
revoke all on function public.prize_create(uuid,text,text,integer,boolean,text),
  public.prize_update(uuid,text,text,integer,boolean,text),
  public.draw_load_winning_number(uuid,integer,text,text),public.prize_resolve(uuid,text,text,text),
  public.prize_deliver(uuid,text,text),public.prize_annul(uuid,text,text) from public,anon,service_role;
grant execute on function public.prize_create(uuid,text,text,integer,boolean,text),
  public.prize_update(uuid,text,text,integer,boolean,text),
  public.draw_load_winning_number(uuid,integer,text,text),public.prize_resolve(uuid,text,text,text),
  public.prize_deliver(uuid,text,text),public.prize_annul(uuid,text,text) to authenticated;

-- SAN-77 generator adds authoritative previous-win evaluation, resolved-prize
-- admission and campaign serialization. Cutoff remains in draw_payment_before_cutoff.
-- Caller holds the campaign UPDATE lock before locking the target draw. This
-- excludes concurrent prize mutations (campaign SHARE), including new prizes.
create function public.draw_require_resolved_prizes(p_draw public.draws)
returns void language plpgsql set search_path = '' as $$
begin
  if p_draw.draw_type = 'consolation' and exists (
    select 1 from public.draws prior join public.prizes p on p.draw_id = prior.id
    where prior.campaign_id = p_draw.campaign_id and prior.status <> 'annulled'
      and (prior.draw_date,prior.created_at,prior.id) < (p_draw.draw_date,p_draw.created_at,p_draw.id)
      and p.excludes_from_consolation and p.status = 'pending_validation'
  ) then
    raise exception 'previous draws of the campaign have unresolved prizes that exclude from consolation'
      using errcode = '55000';
  end if;
end $$;
revoke all on function public.draw_require_resolved_prizes(public.draws)
  from public,anon,authenticated,service_role;

create or replace function public.draw_generate_roster(p_draw_id uuid, p_request_id text default null)
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
  v_required integer;
begin
  if p_draw_id is null then
    raise exception 'draw id is required' using errcode = '22023';
  end if;
  select campaign_id into v_campaign from public.draws where id = p_draw_id;
  if not found then raise exception 'draw not found' using errcode = 'P0002'; end if;
  select max_number,status into v_max,v_campaign_status
    from public.campaigns where id = v_campaign for update;
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

create or replace function public.draw_freeze_roster(p_draw_id uuid, p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.bond_require_actor('draw.freeze_roster');
  v_campaign uuid;
  v_draw public.draws;
  v_roster public.draw_rosters;
begin
  if p_draw_id is null then raise exception 'draw id is required' using errcode = '22023'; end if;
  select campaign_id into v_campaign from public.draws where id = p_draw_id;
  if not found then raise exception 'draw not found' using errcode = 'P0002'; end if;
  -- Same parent-first lock order as generation; excludes all prize RPC writes.
  perform 1 from public.campaigns where id = v_campaign for update;
  select * into v_draw from public.draws where id = p_draw_id for update;
  perform public.draw_require_resolved_prizes(v_draw);
  -- Preserve the idempotent no-op when the admission gate still holds.
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
end $$;
revoke all on function public.draw_freeze_roster(uuid,text) from public,anon,service_role;
grant execute on function public.draw_freeze_roster(uuid,text) to authenticated;
