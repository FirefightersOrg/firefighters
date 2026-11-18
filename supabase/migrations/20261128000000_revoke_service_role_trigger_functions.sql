-- service_role receives EXECUTE through default privileges; trigger functions must remain internal.
revoke all on function public.commission_rules_guard_write() from service_role;
revoke all on function public.commission_rules_forbid_delete() from service_role;
revoke all on function public.campaigns_guard_commission_installments() from service_role;
revoke all on function public.audit_log_forbid_mutation() from service_role;
revoke all on function public.audit_log_set_created_at() from service_role;
revoke all on function public.campaigns_forbid_delete() from service_role;
revoke all on function public.campaigns_guard_write() from service_role;
revoke all on function public.guard_last_user_manage_holder() from service_role;
revoke all on function public.profiles_sync_email_from_auth() from service_role;
