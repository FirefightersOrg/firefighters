-- SAN-59: sale_register API surface and security contract. Full sale flows are also covered by
-- tests/integration/sales.test.ts; this pgTAP file keeps migration-level grants explicit.
begin;
select plan(6);

select has_function('public', 'sale_register',
  array['uuid', 'uuid', 'uuid', 'text', 'date', 'text'], 'sale_register has the public RPC signature');
select function_returns('public', 'sale_register',
  array['uuid', 'uuid', 'uuid', 'text', 'date', 'text'], 'uuid', 'sale_register returns the sale id');
select ok(
  has_function_privilege('authenticated', 'public.sale_register(uuid, uuid, uuid, text, date, text)', 'execute'),
  'authenticated can execute sale_register'
);
select ok(
  not has_function_privilege('anon', 'public.sale_register(uuid, uuid, uuid, text, date, text)', 'execute')
  and not has_function_privilege('service_role', 'public.sale_register(uuid, uuid, uuid, text, date, text)', 'execute'),
  'anon and service_role cannot execute sale_register'
);
select throws_ok(
  $$select public.sale_register(null, null, null, 'barter', current_date, null)$$,
  '42501', null, 'active profile and sale.create are required before validation'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.sale_register(uuid, uuid, uuid, text, date, text)'::regprocedure),
  true, 'sale_register is SECURITY DEFINER'
);

select * from finish();
rollback;
