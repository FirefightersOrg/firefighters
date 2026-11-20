-- SAN-83: narrowly expose printable prize-certificate data without granting
-- ordinary prize readers access to profiles or audit_log.
create function public.prize_certificate_data(p_prize_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not (
    public.has_permission('draw.view')
    or public.has_permission('draw.create')
    or public.has_permission('draw.update')
    or public.has_permission('draw.generate_roster')
    or public.has_permission('draw.freeze_roster')
    or public.has_permission('draw.load_winner')
    or public.has_permission('prize.resolve')
    or public.has_permission('prize.deliver')
    or public.has_permission('prize.annul')
  ) then
    raise exception 'prize certificate permission required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'campaign_id', d.campaign_id,
    'draw_id', d.id,
    'draw_name', d.name,
    'draw_type', d.draw_type,
    'draw_date', d.draw_date,
    'prize_id', p.id,
    'prize_name', p.name,
    'prize_position', p.position,
    'prize_status', p.status,
    'winning_number', w.number_value,
    'winner_status', w.result_status,
    'winner_notes', w.notes,
    'roster_eligible', e.eligible,
    'ineligibility_reason', e.ineligibility_reason,
    'buyer_snapshot', e.buyer_snapshot,
    'collector_snapshot', e.collector_snapshot,
    'bond_id', e.bond_id,
    'bond_label', b.internal_code,
    'award_status', a.status,
    'delivered_at', a.delivered_at,
    'delivery_notes', a.notes,
    'delivered_by_name', delivered_by.full_name,
    'unawarded_by_name', unawarded_by.full_name,
    'unawarded_at', resolution.created_at,
    'resolution_notes', resolution.reason
  )
  into v_result
  from public.prizes p
  join public.draws d on d.id = p.draw_id
  left join public.winning_numbers w on w.prize_id = p.id
  left join public.draw_roster_entries e on e.id = w.matched_roster_entry_id
  left join public.bonds b on b.id = e.bond_id
  left join public.prize_awards a on a.prize_id = p.id and a.status <> 'annulled'
  left join public.profiles delivered_by on delivered_by.id = a.delivered_by
  left join lateral (
    select log.actor_user_id, log.created_at, log.reason
    from public.audit_log log
    where log.entity_type = 'prize'
      and log.entity_id = p.id::text
      and log.action = case
        when w.result_status = 'eligible_winner' then 'prize.resolve'
        else 'draw.load_winner'
      end
    order by log.created_at desc, log.id desc
    limit 1
  ) resolution on p.status = 'unawarded'
  left join public.profiles unawarded_by on unawarded_by.id = resolution.actor_user_id
  where p.id = p_prize_id;

  if v_result is null then
    raise exception 'prize not found' using errcode = 'P0002';
  end if;
  return v_result;
end
$$;

revoke all on function public.prize_certificate_data(uuid) from public, anon, service_role;
grant execute on function public.prize_certificate_data(uuid) to authenticated;
