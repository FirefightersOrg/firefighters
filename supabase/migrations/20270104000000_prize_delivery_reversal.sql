-- SAN-125: each reversed delivery is an immutable historical event. The award
-- keeps only the current delivery; redelivery cannot overwrite earlier events.
insert into public.permissions(code,description)
values ('prize.reverse_delivery','Reverse an incorrectly recorded prize delivery.');
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.name = 'admin' and p.code = 'prize.reverse_delivery';

create table public.prize_delivery_reversals (
  id uuid primary key default gen_random_uuid(),
  prize_id uuid not null references public.prizes(id) on delete restrict,
  award_id uuid not null references public.prize_awards(id) on delete restrict,
  delivered_at timestamptz not null,
  delivered_by uuid not null references public.profiles(id) on delete restrict,
  notes text not null check (notes = btrim(notes) and notes <> '' and char_length(notes) <= 1000),
  award_snapshot jsonb not null,
  reversed_at timestamptz not null default now(),
  reversed_by uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (reason = btrim(reason) and reason <> '' and char_length(reason) <= 1000)
);
create index prize_delivery_reversals_prize_idx on public.prize_delivery_reversals(prize_id);
create index prize_delivery_reversals_award_idx on public.prize_delivery_reversals(award_id);
create index prize_delivery_reversals_delivered_by_idx on public.prize_delivery_reversals(delivered_by);
create index prize_delivery_reversals_reversed_by_idx on public.prize_delivery_reversals(reversed_by);
revoke all on public.prize_delivery_reversals from public,anon,authenticated,service_role;
grant select on public.prize_delivery_reversals to authenticated;
alter table public.prize_delivery_reversals enable row level security;
create policy prize_delivery_reversals_select on public.prize_delivery_reversals
for select to authenticated using ((select public.prize_can_read()));
create trigger prize_delivery_reversals_immutable before update or delete
on public.prize_delivery_reversals for each row execute function public.draws_forbid_delete();
create trigger prize_delivery_reversals_no_truncate before truncate
on public.prize_delivery_reversals for each statement execute function public.draws_forbid_delete();

-- Reuse SAN-81's correction pattern, but allow exactly the reverse-delivery
-- transition and no configuration/identity/history edits. API roles have no DML.
drop trigger prizes_guard_write on public.prizes;
drop trigger prize_awards_guard_write on public.prize_awards;
create trigger prizes_guard_write before insert or update on public.prizes
for each row when (current_setting('app.prize_annul',true) is distinct from 'on'
  and current_setting('app.prize_reverse_delivery',true) is distinct from 'on')
execute function public.prizes_guard_write();
create trigger prize_awards_guard_write before insert or update on public.prize_awards
for each row when (current_setting('app.prize_annul',true) is distinct from 'on'
  and current_setting('app.prize_reverse_delivery',true) is distinct from 'on')
execute function public.prize_awards_guard_write();
create function public.prize_guard_reverse_delivery() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('app.prize_reverse_delivery',true) = 'on' then
    if tg_op <> 'UPDATE' then
      raise exception 'delivery reversal cannot insert' using errcode = '55000';
    end if;
    if old.status <> 'delivered' then
      raise exception 'delivery reversal requires delivered state' using errcode = '55000';
    end if;
    if tg_table_name = 'prizes' then
      if new.status <> 'pending_delivery' or
        (to_jsonb(new) - array['status','updated_at']) is distinct from
        (to_jsonb(old) - array['status','updated_at']) then
        raise exception 'delivery reversal must preserve prize' using errcode = '55000';
      end if;
    else
      if new.status <> 'awarded' or new.delivered_at is not null or new.delivered_by is not null
        or not exists (select 1 from public.prize_delivery_reversals h
          where h.award_id = old.id and h.award_snapshot = to_jsonb(old))
        or (to_jsonb(new) - array['status','delivered_at','delivered_by','notes','updated_at'])
          is distinct from
          (to_jsonb(old) - array['status','delivered_at','delivered_by','notes','updated_at']) then
        raise exception 'delivery reversal must archive original award' using errcode = '55000';
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke all on function public.prize_guard_reverse_delivery() from public,anon,authenticated,service_role;
create trigger prizes_guard_reverse_delivery before insert or update on public.prizes
for each row execute function public.prize_guard_reverse_delivery();
create trigger prize_awards_guard_reverse_delivery before insert or update on public.prize_awards
for each row execute function public.prize_guard_reverse_delivery();

create function public.prize_reverse_delivery(p_prize_id uuid,p_reason text,p_request_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.bond_require_actor('prize.reverse_delivery');
  old_p public.prizes; p public.prizes; a public.prize_awards;
  previous_flag text := current_setting('app.prize_reverse_delivery',true);
  history public.prize_delivery_reversals; restored_notes text;
begin
  -- Unchanged SAN-81 order: campaign -> draw -> prize -> winner -> awards.
  old_p := public.prize_lock(p_prize_id);
  if old_p.status <> 'delivered' then
    raise exception 'prize must be delivered' using errcode = '55000';
  end if;
  perform public.prize_validate_text(p_reason,1000,true);
  select * into a from public.prize_awards where prize_id=p_prize_id and status='delivered';
  if not found then raise exception 'delivered award required' using errcode = '55000'; end if;
  -- Recover the award's pre-delivery notes from its original resolution audit,
  -- not from a caller-supplied snapshot. Delivery notes are archived below.
  select log.new_value->'awards'->0->>'notes' into restored_notes
  from public.audit_log log where log.entity_id=p_prize_id::text and log.entity_type='prize'
    and log.action='prize.resolve'
  order by log.created_at desc,log.id desc limit 1;
  insert into public.prize_delivery_reversals(prize_id,award_id,delivered_at,delivered_by,notes,
    award_snapshot,reversed_by,reason)
  values(p_prize_id,a.id,a.delivered_at,a.delivered_by,a.notes,to_jsonb(a),actor,btrim(p_reason))
  returning * into history;
  perform set_config('app.prize_reverse_delivery','on',true);
  update public.prize_awards set status='awarded',delivered_at=null,delivered_by=null,
    notes=restored_notes where id=a.id;
  update public.prizes set status='pending_delivery' where id=p_prize_id returning * into p;
  perform set_config('app.prize_reverse_delivery',coalesce(previous_flag,''),true);
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,reason,request_id)
  values(actor,'prize.reverse_delivery','prize',p_prize_id,
    jsonb_build_object('prize',to_jsonb(old_p),'award',to_jsonb(a)),
    jsonb_build_object('campaign_id',(select campaign_id from public.draws where id=p.draw_id),
      'prize',to_jsonb(p),'award',(select to_jsonb(x) from public.prize_awards x where id=a.id),
      'reversal',to_jsonb(history)),btrim(p_reason),p_request_id);
end $$;
revoke all on function public.prize_reverse_delivery(uuid,text,text) from public,anon,service_role;
grant execute on function public.prize_reverse_delivery(uuid,text,text) to authenticated;
