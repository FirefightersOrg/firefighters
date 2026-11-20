-- SAN-73 review (#74): the campaign audit viewer filters with
--   entity_id = :campaign OR old_value->>'campaign_id' = :campaign OR new_value->>'campaign_id' = :campaign
-- (plus count: 'exact'). Without matching indexes every branch scans audit_log. One index per
-- OR branch lets the planner use a BitmapOr instead. entity_id alone (the existing index leads
-- with entity_type, which this filter does not set).
create index audit_log_entity_id_idx on public.audit_log (entity_id);
create index audit_log_old_campaign_idx on public.audit_log ((old_value ->> 'campaign_id'));
create index audit_log_new_campaign_idx on public.audit_log ((new_value ->> 'campaign_id'));
