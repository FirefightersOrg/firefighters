begin;
select plan(32);

select has_table('public', t, t || ' exists')
from unnest(array['profiles', 'roles', 'permissions', 'role_permissions', 'user_roles', 'audit_log']) as t;

select col_is_pk('public', 'profiles', 'id', 'profiles.id is pk');
select col_is_unique('public', 'profiles', 'auth_user_id', 'profiles.auth_user_id is unique');
select col_is_unique('public', 'profiles', 'email', 'profiles.email is unique');
select has_index('public', 'profiles', 'profiles_email_lower_key', 'profiles has lower(email) unique index');
select col_not_null('public', 'profiles', 'full_name', 'profiles.full_name not null');
select col_default_is('public', 'profiles', 'status', 'active', 'profiles.status defaults to active');
select col_is_fk('public', 'profiles', 'auth_user_id', 'profiles.auth_user_id references auth.users');

select col_is_unique('public', 'roles', 'name', 'roles.name is unique');
select col_is_unique('public', 'permissions', 'code', 'permissions.code is unique');
select col_not_null('public', 'permissions', 'description', 'permissions.description not null');

select col_is_pk('public', 'role_permissions', array['role_id', 'permission_id'], 'role_permissions composite pk');
select has_index('public', 'role_permissions', 'role_permissions_permission_id_idx', 'role_permissions permission_id index');
select col_is_pk('public', 'user_roles', array['user_id', 'role_id'], 'user_roles composite pk');
select has_index('public', 'user_roles', 'user_roles_role_id_idx', 'user_roles role_id index');
select fk_ok('public', 'user_roles', 'user_id', 'public', 'profiles', 'id', 'user_roles.user_id references profiles.id');

select col_is_pk('public', 'audit_log', 'id', 'audit_log.id is pk');
select col_is_null('public', 'audit_log', 'actor_user_id', 'audit_log.actor_user_id is nullable');
select col_type_is('public', 'audit_log', 'old_value', 'jsonb', 'audit_log.old_value is jsonb');
select col_type_is('public', 'audit_log', 'new_value', 'jsonb', 'audit_log.new_value is jsonb');
select col_type_is('public', 'audit_log', 'entity_id', 'text', 'audit_log.entity_id is text');
select col_type_is('public', 'audit_log', 'request_id', 'text', 'audit_log.request_id is text');
select has_index('public', 'audit_log', 'audit_log_entity_idx', 'audit_log entity index');
select has_index('public', 'audit_log', 'audit_log_request_id_idx', 'audit_log request_id index');

select throws_ok(
  $$insert into public.roles (name) values ('admin')$$,
  '23505', null, 'duplicate roles.name is rejected'
);
select throws_ok(
  $$insert into public.permissions (code, description) values ('user.manage', 'dup')$$,
  '23505', null, 'duplicate permissions.code is rejected'
);
select throws_ok(
  $$insert into public.profiles (auth_user_id, full_name, email) values (gen_random_uuid(), 'x', 'x@example.com')$$,
  '23503', null, 'profile requires an existing auth user'
);

select * from finish();
rollback;
