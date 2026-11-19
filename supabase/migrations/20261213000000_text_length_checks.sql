-- SAN-97: maximum text lengths enforced at the database for RPC-exposed free-text columns.
--
-- The SECURITY DEFINER functions are callable through PostgREST, so a caller can skip the Zod
-- schemas and send text of any length. Each limit below equals the Zod maximum that validates the
-- same field (source in the last column of the list); columns that already had a char_length CHECK
-- (import_sessions.file_name / notes, import_session_items.*, collectors, buyers,
-- campaigns.barcode_pattern) are left as they are.
--
--   table.column                           max   source
--   campaigns.name                         200   CAMPAIGN_NAME_MAX_LENGTH (schemas/campaign.ts)
--   bonds.internal_code                    200   BARCODE_MAX_LENGTH (domain/barcodes.ts; imports)
--   bonds.barcode                          200   BARCODE_MAX_LENGTH
--   bond_numbers.barcode                   200   BARCODE_MAX_LENGTH
--   bonds.annul_reason                    1000   BOND_REASON_MAX_LENGTH (schemas/bond.ts)
--   bond_groups.reason                    1000   BOND_REASON_MAX_LENGTH
--   commission_rules.annul_reason         1000   COMMISSION_REASON_MAX_LENGTH (schemas/commission-rule.ts)
--   import_sessions.cancel_reason          500   IMPORT_REASON_MAX_LENGTH (schemas/import.ts)
--   import_sessions.rollback_reason        500   IMPORT_REASON_MAX_LENGTH
--   import_sessions.failure_reason         500   IMPORT_REASON_MAX_LENGTH
--   import_session_items.remove_reason     500   IMPORT_REASON_MAX_LENGTH
--   import_session_items.error_message     500   errorMessage in schemas/import.ts
--   profiles.full_name                     200   PROFILE_FULL_NAME_MAX_LENGTH (services/user-admin.ts)
--   profiles.email                         254   PROFILE_EMAIL_MAX_LENGTH (services/user-admin.ts)
--   audit_log.reason                      1000   largest reason limit above (see below)
--   audit_log.request_id                   100   REQUEST_ID_MAX_LENGTH (services/user-admin.ts, audit.ts)
--
-- audit_log.reason is shared by every audited function, so it takes the largest per-function limit;
-- the tighter ones (500 for rule changes and imports) stay in Zod and in the per-column CHECKs.
-- bonds.internal_code / barcode: manual entry is limited to 100 by Zod (BOND_CODE_MAX_LENGTH), but
-- bonds created by an import carry the import's barcode (up to 200), so the column takes 200.

do $$
declare
  v_limit record;
  v_violations bigint;
begin
  for v_limit in
    select * from (values
      ('campaigns', 'name', 200),
      ('bonds', 'internal_code', 200),
      ('bonds', 'barcode', 200),
      ('bond_numbers', 'barcode', 200),
      ('bonds', 'annul_reason', 1000),
      ('bond_groups', 'reason', 1000),
      ('commission_rules', 'annul_reason', 1000),
      ('import_sessions', 'cancel_reason', 500),
      ('import_sessions', 'rollback_reason', 500),
      ('import_sessions', 'failure_reason', 500),
      ('import_session_items', 'remove_reason', 500),
      ('import_session_items', 'error_message', 500),
      ('profiles', 'full_name', 200),
      ('profiles', 'email', 254),
      ('audit_log', 'reason', 1000),
      ('audit_log', 'request_id', 100)
    ) as t (tbl, col, max_length)
  loop
    execute format('select count(*) from public.%I where char_length(%I) > %s',
      v_limit.tbl, v_limit.col, v_limit.max_length)
      into v_violations;
    if v_violations > 0 then
      raise exception 'SAN-97: % row(s) of public.%.% are longer than % characters; fix them first',
        v_violations, v_limit.tbl, v_limit.col, v_limit.max_length;
    end if;
  end loop;
end
$$;

alter table public.campaigns
  add constraint campaigns_name_max_length check (char_length(name) <= 200);

alter table public.bonds
  add constraint bonds_internal_code_max_length check (char_length(internal_code) <= 200),
  add constraint bonds_barcode_max_length check (char_length(barcode) <= 200),
  add constraint bonds_annul_reason_max_length check (char_length(annul_reason) <= 1000);

alter table public.bond_numbers
  add constraint bond_numbers_barcode_max_length check (char_length(barcode) <= 200);

alter table public.bond_groups
  add constraint bond_groups_reason_max_length check (char_length(reason) <= 1000);

alter table public.commission_rules
  add constraint commission_rules_annul_reason_max_length check (char_length(annul_reason) <= 1000);

alter table public.import_sessions
  add constraint import_sessions_cancel_reason_max_length check (char_length(cancel_reason) <= 500),
  add constraint import_sessions_rollback_reason_max_length check (char_length(rollback_reason) <= 500),
  add constraint import_sessions_failure_reason_max_length check (char_length(failure_reason) <= 500);

alter table public.import_session_items
  add constraint import_session_items_remove_reason_max_length check (char_length(remove_reason) <= 500),
  add constraint import_session_items_error_message_max_length check (char_length(error_message) <= 500);

alter table public.profiles
  add constraint profiles_full_name_max_length check (char_length(full_name) <= 200),
  add constraint profiles_email_max_length check (char_length(email) <= 254);

alter table public.audit_log
  add constraint audit_log_reason_max_length check (char_length(reason) <= 1000),
  add constraint audit_log_request_id_max_length check (char_length(request_id) <= 100);
