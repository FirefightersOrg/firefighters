-- SAN-74 / SAN-73 fix: audit_log.campaign_scope resolves the campaign of correction rows.
begin;
select plan(5);
select ok(to_regclass('public.audit_log_campaign_scope_idx') is not null, 'campaign_scope index');
insert into public.audit_log(action, entity_type, entity_id, new_value, request_id) values
  ('t.top', 'x', 'e1', '{"campaign_id":"c-top"}', 'p036-1'),
  ('payment.annul', 'payment', 'e2', '{"previous_value":{"payment":{"campaign_id":"c-pay"}}}', 'p036-2'),
  ('sale.correct_buyer', 'sale', 'e3', '{"previous_value":{"sale":{"campaign_id":"c-sale"}}}', 'p036-3'),
  ('settlement.correct', 'settlement', 'e4', '{"previous_value":{"settlement":{"campaign_id":"c-set"}}}', 'p036-4');
select is((select campaign_scope from public.audit_log where request_id='p036-1'), 'c-top', 'top-level campaign_id');
select is((select campaign_scope from public.audit_log where request_id='p036-2'), 'c-pay', 'payment correction snapshot');
select is((select campaign_scope from public.audit_log where request_id='p036-3'), 'c-sale', 'sale correction snapshot');
select is((select campaign_scope from public.audit_log where request_id='p036-4'), 'c-set', 'settlement correction snapshot');
select * from finish();
rollback;
