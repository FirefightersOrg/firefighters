-- service_role receives EXECUTE through default privileges; trigger functions must remain internal.
revoke all on function public.commission_rules_guard_write() from service_role;
revoke all on function public.commission_rules_forbid_delete() from service_role;
revoke all on function public.campaigns_guard_commission_installments() from service_role;
