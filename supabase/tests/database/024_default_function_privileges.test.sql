-- SAN-102: new functions in schema public are not executable without an explicit grant.
begin;
select plan(14);

-- ---------------------------------------------------------------------------
-- Default ACL recorded for functions that postgres (the migration role) creates in public
-- ---------------------------------------------------------------------------
select isnt(
  (select d.defaclacl
   from pg_default_acl d
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype = 'f'),
  null,
  'postgres has default privileges recorded for functions in public'
);

-- grantee 0 is PUBLIC in aclexplode()
select is(
  (select count(*)::int
   from pg_default_acl d, aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype = 'f'
     and a.privilege_type = 'EXECUTE'
     and a.grantee = 0),
  0,
  'default ACL does not grant EXECUTE to PUBLIC'
);

select is(
  (select array_agg(r.rolname::text order by r.rolname)
   from pg_default_acl d, aclexplode(d.defaclacl) a
   join pg_roles r on r.oid = a.grantee
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype = 'f'
     and a.privilege_type = 'EXECUTE'
     and r.rolname in ('anon', 'authenticated', 'service_role')),
  null,
  'default ACL does not grant EXECUTE to anon, authenticated or service_role'
);

select is(
  (select array_agg(pg_get_userbyid(a.grantee)::text)
   from pg_default_acl d, aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype = 'f'
     and a.privilege_type = 'EXECUTE'),
  array['postgres'],
  'only the owner keeps EXECUTE in the default ACL'
);

-- Per-schema defaults only add to the global ones, so the global default for postgres functions
-- must exist and must not grant EXECUTE to PUBLIC (or anyone but the owner).
select is(
  (select array_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end)
   from pg_default_acl d, aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 0
     and d.defaclobjtype = 'f'
     and a.privilege_type = 'EXECUTE'),
  array['postgres'],
  'global default ACL for postgres functions grants EXECUTE only to the owner'
);

-- ---------------------------------------------------------------------------
-- A function created now (as postgres, like a migration) is not executable by the API roles
-- ---------------------------------------------------------------------------
create function public.san102_probe() returns integer
language sql
as $$ select 1 $$;

select ok(
  not has_function_privilege('public', 'public.san102_probe()', 'execute'),
  'PUBLIC cannot execute a new function'
);

select is(
  pg_get_userbyid((select proowner from pg_proc where oid = 'public.san102_probe()'::regprocedure)),
  'postgres',
  'the probe function is owned by postgres'
);

select ok(
  not has_function_privilege('anon', 'public.san102_probe()', 'execute'),
  'anon cannot execute a new function'
);
select ok(
  not has_function_privilege('authenticated', 'public.san102_probe()', 'execute'),
  'authenticated cannot execute a new function'
);
select ok(
  not has_function_privilege('service_role', 'public.san102_probe()', 'execute'),
  'service_role cannot execute a new function'
);

set local role anon;
select throws_ok(
  'select public.san102_probe()',
  '42501',
  null,
  'calling a new function as anon fails with insufficient_privilege'
);
reset role;

set local role authenticated;
select throws_ok(
  'select public.san102_probe()',
  '42501',
  null,
  'calling a new function as authenticated fails with insufficient_privilege'
);
reset role;

-- An explicit grant is what makes it callable.
grant execute on function public.san102_probe() to authenticated;

select ok(
  has_function_privilege('authenticated', 'public.san102_probe()', 'execute'),
  'an explicit grant makes the function executable by authenticated'
);
select ok(
  not has_function_privilege('anon', 'public.san102_probe()', 'execute'),
  'the explicit grant to authenticated does not reach anon'
);

select * from finish();
rollback;
