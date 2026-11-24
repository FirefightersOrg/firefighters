-- SAN-123: the missing roster_frozen -> completed draw transition (docs/state-machines.md).
-- Permission: draw.update (same as draw_annul until SAN-118 splits draw permissions).
-- Preconditions: at least one resolved non-annulled prize, and every non-annulled prize resolved (no pending_validation prize),
-- so a completed draw never hides an unresolved winner. pending_delivery is resolved: delivery
-- may happen after completion. Lock order: campaign SHARE -> draw UPDATE (prize_lock_draw), then
-- the draw's prizes FOR SHARE, so a concurrent prize write either commits first or waits.
create function public.draw_complete(p_draw_id uuid, p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.bond_require_actor('draw.update');
  v_old public.draws;
  v_new public.draws;
begin
  v_old := public.prize_lock_draw(p_draw_id);
  if v_old.status <> 'roster_frozen' then
    raise exception 'only draws with a frozen roster can be completed' using errcode = '55000';
  end if;
  perform 1 from public.prizes where draw_id = p_draw_id order by id for share;
  if exists (select 1 from public.prizes
             where draw_id = p_draw_id and status = 'pending_validation') then
    raise exception 'resolve every prize of the draw before completing it' using errcode = '55000';
  end if;
  -- Santi's decision (#93): a draw without at least one resolved, non-annulled prize cannot be
  -- completed (zero prizes, or only annulled ones).
  if not exists (select 1 from public.prizes
                 where draw_id = p_draw_id and status not in ('pending_validation','annulled')) then
    raise exception 'a draw needs at least one resolved prize to be completed' using errcode = '55000';
  end if;
  update public.draws set status = 'completed' where id = p_draw_id returning * into v_new;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,request_id)
    values(v_actor,'draw.complete','draw',p_draw_id,to_jsonb(v_old),to_jsonb(v_new),p_request_id);
end $$;
revoke all on function public.draw_complete(uuid,text) from public, anon, service_role;
grant execute on function public.draw_complete(uuid,text) to authenticated;
