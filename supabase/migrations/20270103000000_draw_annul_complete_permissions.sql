-- SAN-118: lifecycle transitions have independent, admin-only permissions.
insert into public.permissions(code,description)
values ('draw.annul','Annul a scheduled draw.'),
       ('draw.complete','Complete a draw with a frozen roster and resolved prizes.');
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.name = 'admin' and p.code in ('draw.annul','draw.complete');

-- Only the authorization changes: preserve locks, validation, state and audit.
create or replace function public.draw_annul(p_draw_id uuid,p_reason text,p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.bond_require_actor('draw.annul');
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
revoke all on function public.draw_annul(uuid,text,text) from public, anon, service_role;
grant execute on function public.draw_annul(uuid,text,text) to authenticated;

create or replace function public.draw_complete(p_draw_id uuid, p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.bond_require_actor('draw.complete');
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
  -- At least one resolved, non-annulled prize is required (SAN-123).
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
