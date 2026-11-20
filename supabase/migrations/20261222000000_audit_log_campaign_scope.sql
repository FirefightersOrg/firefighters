-- SAN-74 found that the campaign audit viewer (SAN-73) shows no correction at all: correction rows
-- (SAN-71/72, 9-field format) carry campaign_id nested in the snapshot of the corrected row
-- (new_value.previous_value.payment|sale|settlement.campaign_id), never at the top level the
-- viewer filtered on. A stored generated column resolves the campaign once, from either place, and
-- is indexed, so the viewer filters on `entity_id = :campaign OR campaign_scope = :campaign`.
-- Text (no uuid cast) so an odd snapshot can never make an insert fail.
alter table public.audit_log add column campaign_scope text generated always as (
  coalesce(
    new_value ->> 'campaign_id',
    old_value ->> 'campaign_id',
    new_value #>> '{previous_value,payment,campaign_id}',
    new_value #>> '{previous_value,sale,campaign_id}',
    new_value #>> '{previous_value,settlement,campaign_id}'
  )
) stored;

create index audit_log_campaign_scope_idx on public.audit_log (campaign_scope);

comment on column public.audit_log.campaign_scope is
  'Campaign the row belongs to when its snapshot says so (top-level or the corrected row snapshot). Generated; used by /campaigns/[id]/audit.';
