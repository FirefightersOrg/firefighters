-- SAN-73 review: indexes backing the campaign audit viewer filter.
begin;
select plan(3);
select ok(to_regclass('public.audit_log_entity_id_idx') is not null, 'audit_log entity_id index');
select ok(to_regclass('public.audit_log_old_campaign_idx') is not null, 'audit_log old_value campaign index');
select ok(to_regclass('public.audit_log_new_campaign_idx') is not null, 'audit_log new_value campaign index');
select * from finish();
rollback;
