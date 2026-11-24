-- SAN-112: freeze campaign membership when history is appended, including sparse diffs.
-- Keep campaign_scope for compatibility; it only describes snapshot-local scope.
alter table public.audit_log add column campaign_id text;

create function public.audit_log_resolve_campaign(
  p_entity_type text, p_entity_id text, p_old jsonb, p_new jsonb
) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_campaign text;
  v_id uuid;
begin
  -- These are global even if a future snapshot happens to contain a campaign_id key.
  if p_entity_type in ('user', 'profile', 'role', 'permission', 'user_role',
                       'role_permission', 'collector', 'buyer') then
    return null;
  end if;
  if p_entity_type = 'campaign' then return p_entity_id; end if;

  v_campaign := coalesce(
    p_new ->> 'campaign_id', p_old ->> 'campaign_id',
    p_new #>> '{previous_value,payment,campaign_id}',
    p_new #>> '{previous_value,sale,campaign_id}',
    p_new #>> '{previous_value,settlement,campaign_id}',
    p_old #>> '{payment,campaign_id}', p_old #>> '{sale,campaign_id}',
    p_old #>> '{settlement,campaign_id}'
  );
  if v_campaign is not null then return v_campaign; end if;

  -- Sparse RPC snapshots omit campaign_id (e.g. payment.annul, bond.deliver).
  -- Identity/parent links in these append-only domain tables cannot move campaigns.
  begin
    v_id := p_entity_id::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  case p_entity_type
    when 'bond' then
      select campaign_id::text into v_campaign from public.bonds where id = v_id;
    when 'bond_number' then
      select campaign_id::text into v_campaign from public.bond_numbers where id = v_id;
    when 'commission_rule' then
      select campaign_id::text into v_campaign from public.commission_rules where id = v_id;
    when 'import_session' then
      select campaign_id::text into v_campaign from public.import_sessions where id = v_id;
    when 'delivery_note' then
      select campaign_id::text into v_campaign from public.delivery_notes where id = v_id;
    when 'sale' then
      select campaign_id::text into v_campaign from public.sales where id = v_id;
    when 'payment' then
      select campaign_id::text into v_campaign from public.payments where id = v_id;
    when 'settlement' then
      select campaign_id::text into v_campaign from public.settlements where id = v_id;
    when 'collector_ledger_entry' then
      select campaign_id::text into v_campaign from public.collector_ledger_entries where id = v_id;
    when 'commission_adjustment' then
      select campaign_id::text into v_campaign from public.commission_adjustments where id = v_id;
    when 'draw' then
      select campaign_id::text into v_campaign from public.draws where id = v_id;
    when 'draw_roster' then
      select d.campaign_id::text into v_campaign
      from public.draw_rosters r join public.draws d on d.id = r.draw_id where r.id = v_id;
    when 'prize' then
      select d.campaign_id::text into v_campaign
      from public.prizes p join public.draws d on d.id = p.draw_id where p.id = v_id;
    else
      v_campaign := null;
  end case;
  return v_campaign;
end;
$$;
revoke all on function public.audit_log_resolve_campaign(text, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create function public.audit_log_set_campaign()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Never trust a supplied scope, including one supplied by a privileged caller.
  new.campaign_id := public.audit_log_resolve_campaign(
    new.entity_type, new.entity_id, new.old_value, new.new_value
  );
  return new;
end;
$$;
revoke all on function public.audit_log_set_campaign()
  from public, anon, authenticated, service_role;
create trigger audit_log_set_campaign before insert on public.audit_log
  for each row execute function public.audit_log_set_campaign();

-- ALTER TABLE holds an exclusive lock until this migration commits. Only this
-- one-off derived-column backfill bypasses the update guard; snapshots stay intact.
alter table public.audit_log disable trigger audit_log_forbid_update_delete;
update public.audit_log
set campaign_id = public.audit_log_resolve_campaign(entity_type, entity_id, old_value, new_value);
alter table public.audit_log enable trigger audit_log_forbid_update_delete;

create index audit_log_campaign_history_idx
  on public.audit_log (campaign_id, created_at desc, id desc);

comment on column public.audit_log.campaign_id is
  'Frozen campaign scope: snapshot campaign or immutable entity-parent mapping at append time; global entities remain null.';
