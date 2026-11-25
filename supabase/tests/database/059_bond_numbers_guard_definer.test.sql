-- SAN-141: the bond_numbers write guard reads draw tables that service_role cannot select, so it
-- must run as its owner with a pinned search_path.
begin;
select plan(3);
select is((select prosecdef from pg_proc where oid = 'public.bond_numbers_guard_write()'::regprocedure),
  true, 'guard is SECURITY DEFINER');
select ok((select coalesce(proconfig, '{}') @> array['search_path=""'] from pg_proc
  where oid = 'public.bond_numbers_guard_write()'::regprocedure), 'guard pins an empty search_path');
select is(has_table_privilege('service_role', 'public.draw_roster_entries', 'select'), false,
  'service_role still cannot read draw_roster_entries directly');
select * from finish();
rollback;
