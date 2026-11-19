-- No trigger function in public is executable by an API role (the default privileges grant
-- EXECUTE to service_role, so every new trigger function must revoke it explicitly).
begin;
select plan(1);

select is(
  (select coalesce(array_agg(format('%s (%s)', p.oid::regprocedure, r.role_name)
     order by p.proname, r.role_name), '{}')
   from pg_proc p
   cross join (values ('anon'), ('authenticated'), ('service_role')) as r (role_name)
   where p.pronamespace = 'public'::regnamespace
     and p.prorettype = 'trigger'::regtype
     and has_function_privilege(r.role_name, p.oid, 'execute')),
  '{}'::text[],
  'no public trigger function is executable by anon, authenticated or service_role'
);

select * from finish();
rollback;
