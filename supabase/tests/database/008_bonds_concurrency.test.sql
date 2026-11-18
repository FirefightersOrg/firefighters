-- SAN-22: ungrouping a manual pata and changing its status serialize (two real sessions).
--
-- The other pgTAP files run in one rolled-back transaction, which cannot show a race. Here two
-- dblink sessions (A and B) work on committed fixtures while this session orchestrates them:
--   1. A ungroups (not committed yet); B tries to deliver the pata. B must wait for A's lock and,
--      once A commits, fail because the pata no longer has its members.
--   2. B delivers (not committed yet); A tries to ungroup. A must wait for B's lock and, once B
--      commits, fail because the pata is no longer available.
-- Either way no pata leaves `available` without its members.
-- Annulment (review of SAN-22): a manual pata can only be annulled with no active members, so
-- its members are never left blocked behind an annulled pata. Annulment and ungrouping lock the
-- same pata row, so they serialize:
--   4. A ungroups through bond_ungroup_pata (ungroup + annul, not committed yet); B tries to annul
--      the pata directly. B waits and, once A commits, fails because the pata is already annulled.
--   5. B ungroups every member (not committed yet); A tries to annul the pata. A waits and, once B
--      commits, succeeds: the pata no longer has active members.
--   6. A ungroups one of two members (not committed yet); B tries to annul the pata. B waits and,
--      once A commits, fails because one member is still active.
-- No annulled manual pata ever keeps active members.
--
-- dblink needs a password-authenticated connection for a non-superuser: it connects to this same
-- server over TCP (inet_server_addr()) as postgres with the local Supabase password. If that is
-- not possible (other environment) the tests are skipped.
--
-- The fixtures are committed, so they are removed at the end (delete triggers are disabled for
-- that cleanup only, inside one transaction of the setup session). This session never touches the
-- bond tables itself, so the cleanup's locks cannot wait on it.
begin;
select plan(24);
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
  perform extensions.dblink_connect('race_setup', v_conninfo);
  perform extensions.dblink_connect('race_a', v_conninfo);
  perform extensions.dblink_connect('race_b', v_conninfo);
  return true;
exception when others then
  raise notice 'dblink unavailable, skipping the race tests: %', sqlerrm;
  return false;
end;
$$;

-- Runs a statement in a session, failing the test run if it fails.
create function pg_temp.exec(p_conn text, p_sql text) returns void language plpgsql as $$
begin
  perform extensions.dblink_exec(p_conn, p_sql);
end;
$$;

-- Single text value from a session.
create function pg_temp.fetch(p_conn text, p_sql text) returns text language sql as $$
  select t.v from extensions.dblink(p_conn, p_sql) as t (v text);
$$;

-- True once the backend p_pid is waiting for a lock (polls for up to 10 seconds).
create function pg_temp.waits_for_lock(p_pid int) returns boolean language plpgsql as $$
begin
  for i in 1..200 loop
    if exists (
      select 1 from pg_stat_activity where pid = p_pid and wait_event_type = 'Lock'
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
  -- fail_on_error = false: the error message is read with dblink_error_message.
  select t.status into v_status
  from extensions.dblink_get_result(p_conn, false) as t (status text);
  v_message := extensions.dblink_error_message(p_conn);
  -- Drain the end-of-results marker so the connection can be reused.
  perform * from extensions.dblink_get_result(p_conn, false) as t (status text);
  -- The remote error comes as 'ERROR:  <message>' plus CONTEXT lines: keep the message only.
  return case
    when v_message = 'OK' then 'ok'
    else regexp_replace(split_part(v_message, E'\n', 1), '^ERROR:\s+', '')
  end;
end;
$$;

insert into race values ('connected', pg_temp.connect_all()::text);

-- ---------------------------------------------------------------------------
-- Fixtures (committed by the setup session)
-- ---------------------------------------------------------------------------
insert into race
select k, gen_random_uuid()::text
from unnest(array['user', 'profile', 'campaign', 'p1', 'p1m1', 'p1m2', 'p2', 'p2m1', 'p2m2',
  'p3', 'p3m1', 'p3m2', 'p4', 'p4m1', 'p4m2', 'p5', 'p5m1', 'p5m2']) as k;

select pg_temp.exec('race_setup', format($sql$
  insert into auth.users (id, email) values (%1$L, %1$L || '@race.example.com');
  insert into public.profiles (id, auth_user_id, full_name, email, status)
    values (%2$L, %1$L, 'Race user', %1$L || '@race.example.com', 'active');
  insert into public.campaigns
    (id, name, simple_bond_value, installment_count, installment_value, barcode_mode, starts_at, ends_at)
    values (%3$L, '[pgtap race] ' || %3$L, 60000, 10, 6000, 'base_number', '2026-03-01 00:00-03',
      '2026-12-31 23:59:59-03');
  insert into public.bonds (id, campaign_id, kind, origin, commercial_unit_count, total_value, created_by)
    values (%4$L, %3$L, 'pata', 'manual_grouping', 2, 120000, %2$L),
           (%5$L, %3$L, 'simple', 'printed', 1, 60000, %2$L),
           (%6$L, %3$L, 'simple', 'printed', 1, 60000, %2$L),
           (%7$L, %3$L, 'pata', 'manual_grouping', 2, 120000, %2$L),
           (%8$L, %3$L, 'simple', 'printed', 1, 60000, %2$L),
           (%9$L, %3$L, 'simple', 'printed', 1, 60000, %2$L);
  insert into public.bond_groups (pata_bond_id, member_bond_id, grouped_by)
    values (%4$L, %5$L, %2$L), (%4$L, %6$L, %2$L), (%7$L, %8$L, %2$L), (%7$L, %9$L, %2$L);
  $sql$,
  pg_temp.v('user'), pg_temp.v('profile'), pg_temp.v('campaign'), pg_temp.v('p1'),
  pg_temp.v('p1m1'), pg_temp.v('p1m2'), pg_temp.v('p2'), pg_temp.v('p2m1'), pg_temp.v('p2m2')))
where pg_temp.v('connected')::boolean;

-- Annulment races: three more complete manual patas of 2, and the operator role (bond.create)
-- so the race user can call bond_ungroup_pata.
select pg_temp.exec('race_setup', format($sql$
  insert into public.user_roles (user_id, role_id)
    select %1$L, r.id from public.roles r where r.name = 'operator';
  insert into public.bonds (id, campaign_id, kind, origin, commercial_unit_count, total_value, created_by)
    values (%3$L, %2$L, 'pata', 'manual_grouping', 2, 120000, %1$L),
           (%4$L, %2$L, 'simple', 'printed', 1, 60000, %1$L),
           (%5$L, %2$L, 'simple', 'printed', 1, 60000, %1$L),
           (%6$L, %2$L, 'pata', 'manual_grouping', 2, 120000, %1$L),
           (%7$L, %2$L, 'simple', 'printed', 1, 60000, %1$L),
           (%8$L, %2$L, 'simple', 'printed', 1, 60000, %1$L),
           (%9$L, %2$L, 'pata', 'manual_grouping', 2, 120000, %1$L),
           (%10$L, %2$L, 'simple', 'printed', 1, 60000, %1$L),
           (%11$L, %2$L, 'simple', 'printed', 1, 60000, %1$L);
  insert into public.bond_groups (pata_bond_id, member_bond_id, grouped_by)
    values (%3$L, %4$L, %1$L), (%3$L, %5$L, %1$L), (%6$L, %7$L, %1$L), (%6$L, %8$L, %1$L),
           (%9$L, %10$L, %1$L), (%9$L, %11$L, %1$L);
  $sql$,
  pg_temp.v('profile'), pg_temp.v('campaign'), pg_temp.v('p3'), pg_temp.v('p3m1'), pg_temp.v('p3m2'),
  pg_temp.v('p4'), pg_temp.v('p4m1'), pg_temp.v('p4m2'), pg_temp.v('p5'), pg_temp.v('p5m1'),
  pg_temp.v('p5m2')))
where pg_temp.v('connected')::boolean;

insert into race
select 'pid_a', pg_temp.fetch('race_a', 'select pg_backend_pid()::text')
where pg_temp.v('connected')::boolean;
insert into race
select 'pid_b', pg_temp.fetch('race_b', 'select pg_backend_pid()::text')
where pg_temp.v('connected')::boolean;

-- ---------------------------------------------------------------------------
-- Tests
-- ---------------------------------------------------------------------------
create function pg_temp.race_tests() returns setof text language plpgsql as $$
declare
  v_ungroup text := 'update public.bond_groups set ungrouped_at = now(), ungrouped_by = %L, '
    || 'reason = ''Race'' where pata_bond_id = %L and ungrouped_at is null';
  v_deliver text := 'update public.bonds set commercial_status = ''delivered_to_collector'' where id = %L';
  v_state text := 'select b.commercial_status || ''/'' || (select count(*) from public.bond_groups g '
    || 'where g.pata_bond_id = b.id and g.ungrouped_at is null) from public.bonds b where b.id = %L';
  v_annul text := 'update public.bonds set commercial_status = ''annulled'', annulled_by = %L, '
    || 'annul_reason = ''Race annul'' where id = %L';
  -- Status of both members and how many active memberships they still have.
  v_members text := 'select string_agg(b.commercial_status, '','' order by b.id) || ''/'' || '
    || '(select count(*) from public.bond_groups g where g.member_bond_id in (%1$L, %2$L) '
    || 'and g.ungrouped_at is null) from public.bonds b where b.id in (%1$L, %2$L)';
begin
  -- A set-returning function runs before any WHERE on its rows: check the connection here.
  if not pg_temp.v('connected')::boolean then
    return;
  end if;

  -- 1. Ungroup first: the concurrent delivery waits, then sees the missing members.
  perform pg_temp.exec('race_a', 'begin');
  perform pg_temp.exec('race_a', format(v_ungroup, pg_temp.v('profile'), pg_temp.v('p1')));
  perform extensions.dblink_send_query('race_b', format(v_deliver, pg_temp.v('p1')));
  return next ok(
    pg_temp.waits_for_lock(pg_temp.v('pid_b')::int),
    'race 1: the delivery waits for the uncommitted ungrouping (pata row locked)'
  );
  perform pg_temp.exec('race_a', 'commit');
  return next is(
    pg_temp.async_result('race_b'),
    format('manually grouped pata %s has 0 of 2 members and cannot leave available', pg_temp.v('p1')),
    'race 1: once the ungrouping commits, the delivery fails (members are gone)'
  );
  return next is(
    pg_temp.fetch('race_setup', format(v_state, pg_temp.v('p1'))), 'available/0',
    'race 1: the pata stays available without members (never delivered without them)'
  );
  return next is(
    pg_temp.fetch('race_setup', format(
      'select string_agg(commercial_status, '','' order by id) from public.bonds where id in (%L, %L)',
      pg_temp.v('p1m1'), pg_temp.v('p1m2'))),
    'available,available',
    'race 1: the former members are available'
  );

  -- 2. Delivery first: the concurrent ungrouping waits, then sees the pata is not available.
  perform pg_temp.exec('race_b', 'begin');
  perform pg_temp.exec('race_b', format(v_deliver, pg_temp.v('p2')));
  perform extensions.dblink_send_query('race_a', format(v_ungroup, pg_temp.v('profile'), pg_temp.v('p2')));
  return next ok(
    pg_temp.waits_for_lock(pg_temp.v('pid_a')::int),
    'race 2: the ungrouping waits for the uncommitted delivery (pata row locked)'
  );
  perform pg_temp.exec('race_b', 'commit');
  return next is(
    pg_temp.async_result('race_a'),
    'only an available pata can be ungrouped (pata status: delivered_to_collector)',
    'race 2: once the delivery commits, the ungrouping fails'
  );
  return next is(
    pg_temp.fetch('race_setup', format(v_state, pg_temp.v('p2'))), 'delivered_to_collector/2',
    'race 2: the delivered pata keeps both members'
  );

  -- The delivered pata can then be sold, still with both members.
  perform pg_temp.exec('race_b', format(
    'update public.bonds set commercial_status = ''sold'' where id = %L', pg_temp.v('p2')));
  return next is(
    pg_temp.fetch('race_setup', format(v_state, pg_temp.v('p2'))), 'sold/2',
    'race 2: the sold pata has all its members'
  );

  -- 3. Same as 2 with the pata sold: a later ungrouping is rejected without waiting.
  perform extensions.dblink_send_query('race_a', format(v_ungroup, pg_temp.v('profile'), pg_temp.v('p2')));
  return next is(
    pg_temp.async_result('race_a'),
    'only an available pata can be ungrouped (pata status: sold)',
    'race 3: a sold pata cannot be ungrouped'
  );

  -- 4. bond_ungroup_pata first (ungroups and annuls): the concurrent direct annulment waits, then
  --    finds the pata already annulled.
  perform pg_temp.exec('race_a', 'begin');
  perform pg_temp.exec('race_a', 'set local role authenticated');
  -- dblink_exec runs statements that return no rows: SET and DO instead of SELECT.
  perform pg_temp.exec('race_a', format(
    'set local request.jwt.claims = %L',
    format('{"sub":"%s","role":"authenticated"}', pg_temp.v('user'))));
  perform pg_temp.exec('race_a', format(
    'do $do$ begin perform public.bond_ungroup_pata(%L, ''Race ungroup''); end $do$', pg_temp.v('p3')));
  perform extensions.dblink_send_query('race_b', format(v_annul, pg_temp.v('profile'), pg_temp.v('p3')));
  return next ok(
    pg_temp.waits_for_lock(pg_temp.v('pid_b')::int),
    'race 4: the direct annulment waits for the uncommitted bond_ungroup_pata (pata row locked)'
  );
  perform pg_temp.exec('race_a', 'commit');
  return next is(
    pg_temp.async_result('race_b'),
    format('bond %s is annulled and cannot be changed', pg_temp.v('p3')),
    'race 4: once the ungrouping commits, the direct annulment fails (already annulled)'
  );
  return next is(
    pg_temp.fetch('race_setup', format(v_state, pg_temp.v('p3'))), 'annulled/0',
    'race 4: the pata is annulled without members'
  );
  return next is(
    pg_temp.fetch('race_setup', format(v_members, pg_temp.v('p3m1'), pg_temp.v('p3m2'))),
    'available,available/0',
    'race 4: the former members are available and free'
  );

  -- 5. Ungrouping first: the concurrent annulment waits, then sees no active members and succeeds.
  perform pg_temp.exec('race_b', 'begin');
  perform pg_temp.exec('race_b', format(v_ungroup, pg_temp.v('profile'), pg_temp.v('p4')));
  perform extensions.dblink_send_query('race_a', format(v_annul, pg_temp.v('profile'), pg_temp.v('p4')));
  return next ok(
    pg_temp.waits_for_lock(pg_temp.v('pid_a')::int),
    'race 5: the annulment waits for the uncommitted ungrouping (pata row locked)'
  );
  perform pg_temp.exec('race_b', 'commit');
  return next is(
    pg_temp.async_result('race_a'), 'ok',
    'race 5: once the ungrouping commits, the annulment succeeds (no active members left)'
  );
  return next is(
    pg_temp.fetch('race_setup', format(v_state, pg_temp.v('p4'))), 'annulled/0',
    'race 5: the pata is annulled without members'
  );
  return next is(
    pg_temp.fetch('race_setup', format(v_members, pg_temp.v('p4m1'), pg_temp.v('p4m2'))),
    'available,available/0',
    'race 5: the former members are available and free'
  );

  -- 6. Partial ungrouping first: the concurrent annulment waits, then sees the remaining member.
  perform pg_temp.exec('race_a', 'begin');
  perform pg_temp.exec('race_a', format(
    'update public.bond_groups set ungrouped_at = now(), ungrouped_by = %L, reason = ''Race'' '
    || 'where pata_bond_id = %L and member_bond_id = %L',
    pg_temp.v('profile'), pg_temp.v('p5'), pg_temp.v('p5m1')));
  perform extensions.dblink_send_query('race_b', format(v_annul, pg_temp.v('profile'), pg_temp.v('p5')));
  return next ok(
    pg_temp.waits_for_lock(pg_temp.v('pid_b')::int),
    'race 6: the annulment waits for the uncommitted partial ungrouping (pata row locked)'
  );
  perform pg_temp.exec('race_a', 'commit');
  return next is(
    pg_temp.async_result('race_b'),
    format('manually grouped pata %s has 1 active members and must be ungrouped before annulment',
      pg_temp.v('p5')),
    'race 6: once the partial ungrouping commits, the annulment fails (one member is still active)'
  );
  return next is(
    pg_temp.fetch('race_setup', format(v_state, pg_temp.v('p5'))), 'available/1',
    'race 6: the pata stays available with its remaining member'
  );

  return next is(
    pg_temp.fetch('race_setup', format(
      'select count(*)::text from public.bonds b where b.campaign_id = %L and b.origin = ''manual_grouping'' '
      || 'and b.commercial_status = ''annulled'' and exists (select 1 from public.bond_groups g '
      || 'where g.pata_bond_id = b.id and g.ungrouped_at is null)',
      pg_temp.v('campaign'))),
    '0',
    'no annulled manual pata keeps active members'
  );
  return next is(
    pg_temp.fetch('race_setup', format(
      'select count(*)::text from public.bonds b where b.campaign_id = %L and b.origin = ''manual_grouping'' '
      || 'and b.commercial_status not in (''available'', ''annulled'') and b.commercial_unit_count <> '
      || '(select count(*) from public.bond_groups g where g.pata_bond_id = b.id and g.ungrouped_at is null)',
      pg_temp.v('campaign'))),
    '0',
    'no manual pata outside available without all its members'
  );
end;
$$;

select * from pg_temp.race_tests();
select skip('dblink cannot connect to this server', 22) where not pg_temp.v('connected')::boolean;

-- ---------------------------------------------------------------------------
-- Cleanup of the committed fixtures (one transaction in the setup session)
-- ---------------------------------------------------------------------------
select lives_ok(
  format($t$select pg_temp.exec('race_setup', %L)$t$, format($sql$
    begin;
    alter table public.bond_groups disable trigger bond_groups_forbid_delete;
    alter table public.bonds disable trigger bonds_forbid_delete;
    alter table public.campaigns disable trigger campaigns_forbid_delete;
    alter table public.audit_log disable trigger audit_log_forbid_update_delete;
    delete from public.audit_log where actor_user_id = %2$L;
    delete from public.user_roles where user_id = %2$L;
    delete from public.bond_groups where pata_bond_id in (select id from public.bonds where campaign_id = %1$L);
    delete from public.bonds where campaign_id = %1$L;
    delete from public.campaigns where id = %1$L;
    delete from public.profiles where id = %2$L;
    delete from auth.users where id = %3$L;
    alter table public.bond_groups enable trigger bond_groups_forbid_delete;
    alter table public.bonds enable trigger bonds_forbid_delete;
    alter table public.campaigns enable trigger campaigns_forbid_delete;
    alter table public.audit_log enable trigger audit_log_forbid_update_delete;
    commit;
    $sql$, pg_temp.v('campaign'), pg_temp.v('profile'), pg_temp.v('user'))),
  'cleanup: the committed race fixtures are removed'
)
where pg_temp.v('connected')::boolean;
select skip('dblink cannot connect to this server', 1) where not pg_temp.v('connected')::boolean;

select is(
  pg_temp.fetch('race_setup', format(
    'select count(*)::text from public.campaigns where id = %L', pg_temp.v('campaign'))),
  '0', 'cleanup: nothing is left behind'
)
where pg_temp.v('connected')::boolean;
select skip('dblink cannot connect to this server', 1) where not pg_temp.v('connected')::boolean;

select extensions.dblink_disconnect(c)
from unnest(extensions.dblink_get_connections()) as c
where pg_temp.v('connected')::boolean;

select * from finish();
rollback;
