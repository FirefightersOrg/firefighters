-- Follow-up of SAN-106 decided in #50 (Juan, 2026-11-25, answer 1): a sale marked UNCOLLECTIBLE loses
-- draw eligibility while it is marked (ineligibility reason 'uncollectible', right after 'not_sold'). A
-- reverted mark gives eligibility back for rosters generated afterwards; frozen rosters never change.
-- Body = 20270122000000 (SAN-152, the bond's own numbers) plus the sale's uncollectible_at in the coverage
-- and the new reason; grants are preserved by CREATE OR REPLACE.

create or replace function public.draw_generate_roster(p_draw_id uuid, p_request_id text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.bond_require_actor('draw.generate_roster');
  v_campaign uuid;
  v_draw_type text;
  v_campaign_status text;
  v_draw public.draws;
  v_roster uuid;
  v_snapshot jsonb;
  v_required integer;
begin
  if p_draw_id is null then
    raise exception 'draw id is required' using errcode = '22023';
  end if;
  select campaign_id,draw_type into v_campaign,v_draw_type from public.draws where id = p_draw_id;
  if not found then raise exception 'draw not found' using errcode = 'P0002'; end if;
  if v_draw_type = 'consolation' then
    select status into v_campaign_status
      from public.campaigns where id = v_campaign for update;
  else
    select status into v_campaign_status
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
  with participants as (
    select b.id as physical_bond_id, coalesce(g.pata_bond_id,b.id) as effective_bond_id
    from public.bonds b left join public.bond_groups g
      on g.member_bond_id = b.id and g.ungrouped_at is null
    where b.campaign_id = v_campaign and b.origin <> 'manual_grouping'
  ), coverage as (
    select p.physical_bond_id,b.id,b.kind,b.commercial_status,b.annulled_at,s.uncollectible_at,
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
      when uncollectible_at is not null then 'uncollectible'
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
  update public.draw_rosters set status = 'superseded'
    where draw_id = p_draw_id and status = 'generated';
  insert into public.draw_rosters(draw_id,generated_by,created_by)
    values(p_draw_id,v_actor,v_actor) returning id into v_roster;
  insert into public.draw_roster_entries(draw_roster_id,bond_id,bond_number_id,number_value,
    buyer_snapshot,collector_snapshot,eligible,ineligibility_reason,created_by)
  select v_roster,n.bond_id,n.id,n.number_value,x.buyer,x.collector,x.reason is null,x.reason,v_actor
    from jsonb_to_recordset(v_snapshot) as x(bond_id uuid,buyer jsonb,collector jsonb,reason text)
    join public.bond_numbers n on n.bond_id = x.bond_id
    where n.released_at is null and n.number_kind in ('base','associated');
  update public.draws set status = 'roster_generated' where id = p_draw_id;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,new_value,request_id)
    values(v_actor,'draw.generate_roster','draw_roster',v_roster,
      jsonb_build_object('draw_id',p_draw_id,'campaign_id',v_campaign,'roster_id',v_roster),p_request_id);
  return v_roster;
end $$;
