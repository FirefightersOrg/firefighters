-- SAN-94: logged-in users can no longer insert into audit_log directly.
-- Audit rows are written only by SECURITY DEFINER functions (which run as the function owner and
-- write the change and its audit row in one transaction) and by trusted service_role code.
-- service_role keeps INSERT (seed/system actors); anon never had it.

drop policy audit_log_insert on public.audit_log;

revoke insert on table public.audit_log from public, anon, authenticated;
revoke insert (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  on table public.audit_log from authenticated;
