-- SAN-96: the last user.manage holder guard serializes concurrent changes (advisory lock).
--
-- Part 1 (two real sessions over dblink, like 008_bonds_concurrency): two committed admins X and
-- Y are the only active user.manage holders. Session A removes one of them (not committed yet)
-- and session B removes the other one:
--   1. A deletes X's admin role; B deletes Y's admin role. B waits for A's advisory lock and, once
--      A commits, fails: Y is the last holder.
--   2. A deactivates Y; B deletes X's admin role. B waits and, once A commits, fails.
--   3. A deletes X's admin role; B deletes Y's admin role. B waits; A rolls back, so B succeeds.
-- Without the lock, B would not wait in 1 and 2, both changes would commit and nobody would be
-- left to manage users. The race needs X and Y to be the only holders: it is skipped if another
-- active holder exists (e.g. after `pnpm seed:admin`), or if dblink cannot reach the server.
-- The committed fixtures are removed before part 2 (guard triggers disabled for that cleanup only).
--
-- Part 2 (this session, rolled back): the function keeps its security settings and privileges,
-- a guarded change takes the advisory lock, and the guard itself still works.
begin;
select plan(21);
-- dblink reports the expected remote errors as notices: keep the output quiet.
set local client_min_messages = warning;

create extension if not exists dblink with schema extensions;

create temporary table race (k text primary key, v text not null);

create function pg_temp.v(p_k text) returns text language sql stable as $$
  select v from race where k = p_k;
$$;

-- Connects the three sessions; false if dblink cannot reach the server.
create function pg_temp.connect_all() returns boolean language plpgsql as $$
declare
  v_conninfo text := format(
    'host=%s port=%s dbname=%s user=postgres password=postgres',
    coalesce(host(inet_server_addr()), '127.0.0.1'), coalesce(inet_server_port(), 5432),
    current_database()
  );
begin
  perform extensions.dblink_connect('guard_setup', v_conninfo);
  perform extensions.dblink_connect('guard_a', v_conninfo);
  perform extensions.dblink_connect('guard_b', v_conninfo);
  return true;
exception when others then
  raise notice 'dblink unavailable, skipping the race tests: %', sqlerrm;
  return false;
end;
$$;

create function pg_temp.exec(p_conn text, p_sql text) returns void language plpgsql as $$
begin
  perform extensions.dblink_exec(p_conn, p_sql);
end;
$$;

create function pg_temp.fetch(p_conn text, p_sql text) returns text language sql as $$
  select t.v from extensions.dblink(p_conn, p_sql) as t (v text);
$$;

-- True once the backend p_pid is waiting for an advisory lock (polls for up to 10 seconds).
create function pg_temp.waits_for_advisory_lock(p_pid int) returns boolean language plpgsql as $$
begin
  for i in 1..200 loop
    if exists (
      select 1 from pg_stat_activity
      where pid = p_pid and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) then
      return true;
    end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end;
$$;

-- Result of a query sent with dblink_send_query: 'ok' or the error message.
create function pg_temp.async_result(p_conn text) returns text language plpgsql as $$
declare
  v_status text;
  v_message text;
begin
  select t.status into v_status
  from extensions.dblink_get_result(p_conn, false) as t (status text);
  v_message := extensions.dblink_error_message(p_conn);
  perform * from extensions.dblink_get_result(p_conn, false) as t (status text);
  return case
    when v_message = 'OK' then 'ok'
    else regexp_replace(split_part(v_message, E'\n', 1), '^ERROR:\s+', '')
  end;
end;
$$;

-- Active profiles holding user.manage, as seen by the setup session (committed state).
create function pg_temp.committed_holders() returns text language sql as $$
  select pg_temp.fetch('guard_setup', $q$
    select coalesce(string_agg(distinct p.full_name, ',' order by p.full_name), '')
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions perm on perm.id = rp.permission_id
    where p.status = 'active' and perm.code = 'user.manage'
  $q$);
$$;

insert into race values ('connected', pg_temp.connect_all()::text);

-- The race only makes sense when X and Y will be the only holders.
insert into race
select 'other_holders', pg_temp.committed_holders()
where pg_temp.v('connected')::boolean;
insert into race values (
  'run_race', (coalesce(pg_temp.v('connected')::boolean, false)
    and coalesce(pg_temp.v('other_holders'), 'x') = '')::text
);

-- ---------------------------------------------------------------------------
-- Fixtures (committed by the setup session)
-- ---------------------------------------------------------------------------
insert into race
select k, gen_random_uuid()::text
from unnest(array['user_x', 'profile_x', 'user_y', 'profile_y']) as k;

select pg_temp.exec('guard_setup', format($sql$
  insert into auth.users (id, email)
    values (%1$L, %1$L || '@guard-race.example.com'), (%3$L, %3$L || '@guard-race.example.com');
  insert into public.profiles (id, auth_user_id, full_name, email, status)
    values (%2$L, %1$L, 'Race X', %1$L || '@guard-race.example.com', 'active'),
           (%4$L, %3$L, 'Race Y', %3$L || '@guard-race.example.com', 'active');
  insert into public.user_roles (user_id, role_id)
    select u.id, r.id from (values (%2$L::uuid), (%4$L::uuid)) as u (id)
    cross join public.roles r where r.name = 'admin';
  $sql$,
  pg_temp.v('user_x'), pg_temp.v('profile_x'), pg_temp.v('user_y'), pg_temp.v('profile_y')))
where pg_temp.v('run_race')::boolean;

insert into race
select 'pid_b', pg_temp.fetch('guard_b', 'select pg_backend_pid()::text')
where pg_temp.v('run_race')::boolean;

-- ---------------------------------------------------------------------------
-- Part 1: races
-- ---------------------------------------------------------------------------
create function pg_temp.race_tests() returns setof text language plpgsql as $$
declare
  v_last text := 'at least one active profile must keep the user.manage permission';
  v_remove_role text := 'delete from public.user_roles where user_id = %L '
    || 'and role_id = (select id from public.roles where name = ''admin'')';
  v_add_role text := 'insert into public.user_roles (user_id, role_id) '
    || 'select %L, id from public.roles where name = ''admin''';
begin
  if not pg_temp.v('run_race')::boolean then
    return;
  end if;

  -- A failing step (e.g. a regression that lets both removals through) must not abort the whole
  -- file: report it and still let the cleanup below remove the committed fixtures.
  begin
  return next is(pg_temp.committed_holders(), 'Race X,Race Y', 'race setup: X and Y are the only holders');

  -- 1. Both remove a role: the second one waits, then sees that it would remove the last holder.
  perform pg_temp.exec('guard_a', 'begin');
  perform pg_temp.exec('guard_a', format(v_remove_role, pg_temp.v('profile_x')));
  perform extensions.dblink_send_query('guard_b', format(v_remove_role, pg_temp.v('profile_y')));
  return next ok(
    pg_temp.waits_for_advisory_lock(pg_temp.v('pid_b')::int),
    'race 1: removing the other admin role waits for the uncommitted removal (advisory lock)'
  );
  perform pg_temp.exec('guard_a', 'commit');
  return next is(pg_temp.async_result('guard_b'), v_last,
    'race 1: once the first removal commits, the second one fails');
  return next is(pg_temp.committed_holders(), 'Race Y', 'race 1: Y keeps user.manage');

  -- 2. A deactivation and a role removal race in the same way.
  perform pg_temp.exec('guard_setup', format(v_add_role, pg_temp.v('profile_x')));
  perform pg_temp.exec('guard_a', 'begin');
  perform pg_temp.exec('guard_a', format(
    'update public.profiles set status = ''inactive'' where id = %L', pg_temp.v('profile_y')));
  perform extensions.dblink_send_query('guard_b', format(v_remove_role, pg_temp.v('profile_x')));
  return next ok(
    pg_temp.waits_for_advisory_lock(pg_temp.v('pid_b')::int),
    'race 2: removing an admin role waits for the uncommitted deactivation (advisory lock)'
  );
  perform pg_temp.exec('guard_a', 'commit');
  return next is(pg_temp.async_result('guard_b'), v_last,
    'race 2: once the deactivation commits, the role removal fails');
  return next is(pg_temp.committed_holders(), 'Race X', 'race 2: X keeps user.manage');

  -- 3. If the first change rolls back, the waiting one goes through.
  perform pg_temp.exec('guard_setup', format(
    'update public.profiles set status = ''active'' where id = %L', pg_temp.v('profile_y')));
  perform pg_temp.exec('guard_a', 'begin');
  perform pg_temp.exec('guard_a', format(v_remove_role, pg_temp.v('profile_x')));
  perform extensions.dblink_send_query('guard_b', format(v_remove_role, pg_temp.v('profile_y')));
  return next ok(
    pg_temp.waits_for_advisory_lock(pg_temp.v('pid_b')::int),
    'race 3: the second removal waits for the uncommitted first one'
  );
  perform pg_temp.exec('guard_a', 'rollback');
  return next is(pg_temp.async_result('guard_b'), 'ok',
    'race 3: once the first removal rolls back, the second one succeeds');
  return next is(pg_temp.committed_holders(), 'Race X', 'race 3: X keeps user.manage');
  exception when others then
    return next fail('race aborted: ' || sqlerrm);
    begin
      perform extensions.dblink_exec('guard_a', 'rollback');
    exception when others then
      null;
    end;
    perform * from extensions.dblink_get_result('guard_b', false) as t (status text);
  end;
end;
$$;

select * from pg_temp.race_tests();
select skip('dblink unavailable or other user.manage holders exist: ' || coalesce(pg_temp.v('other_holders'), 'no dblink'), 10)
where not pg_temp.v('run_race')::boolean;

-- Cleanup of the committed fixtures (one transaction in the setup session). The guard triggers
-- are disabled for this transaction only: removing the race admins may remove the last holder.
select lives_ok(
  format($t$select pg_temp.exec('guard_setup', %L)$t$, format($sql$
    begin;
    alter table public.user_roles disable trigger user_roles_guard_last_user_manage_holder;
    delete from public.user_roles where user_id in (%1$L, %2$L);
    delete from public.profiles where id in (%1$L, %2$L);
    delete from auth.users where id in (%3$L, %4$L);
    alter table public.user_roles enable trigger user_roles_guard_last_user_manage_holder;
    commit;
    $sql$, pg_temp.v('profile_x'), pg_temp.v('profile_y'), pg_temp.v('user_x'), pg_temp.v('user_y'))),
  'cleanup: the committed race fixtures are removed'
)
where pg_temp.v('run_race')::boolean;
select skip('race fixtures were not created', 1) where not pg_temp.v('run_race')::boolean;

select extensions.dblink_disconnect(c)
from unnest(extensions.dblink_get_connections()) as c
where pg_temp.v('connected')::boolean;

-- ---------------------------------------------------------------------------
-- Part 2: function definition, lock and guard (rolled back)
-- ---------------------------------------------------------------------------
create function pg_temp.holds_guard_lock() returns boolean language sql as $$
  select exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 1
      and ((l.classid::bigint << 32) | l.objid::bigint)
        = hashtextextended('guard_last_user_manage_holder', 0)
  );
$$;

select ok(
  (select prosrc ~ 'pg_advisory_xact_lock\(hashtextextended\(''guard_last_user_manage_holder'', 0\)\)'
   from pg_proc where oid = 'public.guard_last_user_manage_holder()'::regprocedure),
  'the guard takes a transaction-level advisory lock with a stable key'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""']
   from pg_proc where oid = 'public.guard_last_user_manage_holder()'::regprocedure),
  'the guard stays security definer with an empty search_path'
);
select is(
  (select coalesce(array_agg(r.role_name order by r.role_name), '{}')
   from (values ('anon'), ('authenticated'), ('service_role')) as r (role_name)
   where has_function_privilege(r.role_name, 'public.guard_last_user_manage_holder()', 'execute')),
  '{}'::text[],
  'the guard is not executable by anon, authenticated or service_role'
);
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.guard_last_user_manage_holder()'::regprocedure and a.grantee = 0
  ),
  'the guard is not executable by public'
);

-- Fixtures: X and Y are admins (rolled back at the end).
insert into auth.users (id, email) values
  ('96000000-0000-0000-0000-000000000001', 'guard-x@example.com'),
  ('96000000-0000-0000-0000-000000000002', 'guard-y@example.com');
insert into public.profiles (id, auth_user_id, full_name, email, status) values
  ('96100000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', 'Guard X', 'guard-x@example.com', 'active'),
  ('96100000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000002', 'Guard Y', 'guard-y@example.com', 'active');
insert into public.user_roles (user_id, role_id)
select u.id, r.id
from (values ('96100000-0000-0000-0000-000000000001'::uuid), ('96100000-0000-0000-0000-000000000002'::uuid)) as u (id)
cross join public.roles r where r.name = 'admin';

select ok(not pg_temp.holds_guard_lock(), 'no guard lock before a guarded change (inserts are not guarded)');
select lives_ok(
  $$delete from public.user_roles where user_id = '96100000-0000-0000-0000-000000000001'$$,
  'with another holder left, X may lose the admin role'
);
select ok(pg_temp.holds_guard_lock(), 'the guarded change took the advisory lock (held until commit)');

-- Every other active holder steps down, so Y is the last one.
update public.profiles set status = 'inactive'
where status = 'active' and id <> '96100000-0000-0000-0000-000000000002';

select throws_ok(
  $$delete from public.user_roles where user_id = '96100000-0000-0000-0000-000000000002'$$,
  '23514', 'at least one active profile must keep the user.manage permission',
  'the last holder still cannot lose the admin role'
);
select throws_ok(
  $$update public.profiles set status = 'inactive' where id = '96100000-0000-0000-0000-000000000002'$$,
  '23514', 'at least one active profile must keep the user.manage permission',
  'the last holder still cannot be deactivated'
);
select throws_ok(
  $$delete from public.role_permissions
    where role_id = (select id from public.roles where name = 'admin')
      and permission_id = (select id from public.permissions where code = 'user.manage')$$,
  '23514', 'at least one active profile must keep the user.manage permission',
  'user.manage still cannot be removed from the last holder''s role'
);

select * from finish();
rollback;
