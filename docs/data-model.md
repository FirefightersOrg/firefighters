# Preliminary data model

## Objective

Define the conceptual relational model for the MVP. Names are preliminary and must later become versioned SQL migrations.

## Principles

- PostgreSQL will be the source of truth.
- Use real foreign keys.
- Use constraints for critical invariants.
- Do not delete historical financial data.
- Model balances as entries, not as editable fields.
- Separate internal value from visible format in bond numbers.
- Maintain configurable rules per campaign.

## Main entities

### campaigns

Represents an annual campaign. Implemented in `20261116000000_campaigns.sql` (SAN-16).

Fields:

- `id` (uuid)
- `name` (text, not blank)
- `status` (text): `draft` (default), `active`, `closing`, `closed`, `annulled`
- `starts_at`, `ends_at` (timestamptz, optional; `ends_at > starts_at` when both are set)
- `simple_bond_value` (numeric(14,2), > 0)
- `installment_count` (integer, > 0)
- `installment_value` (numeric(14,2), > 0): derived, see rules
- `number_digits` (integer, default 4)
- `max_number` (integer, default 9999)
- `associated_number_offset` (integer, default 4871)
- `overflow_policy` (text, default `reject`; only `reject` for now)
- `barcode_mode` (text, required, no default): `base_number`, `internal_code`, `external_legacy_code`, `manual_mapping`
- `created_by` (profile, nullable for system actions, `on delete restrict`)
- `created_at`, `updated_at` (set by the database)

Constraints:

- `number_digits > 0`, `max_number > 0`, `associated_number_offset >= 0`.
- `max_number` fits in `number_digits` (`max_number < 10^number_digits`); 5-digit campaigns use `number_digits = 5`, `max_number = 99999`.
- `associated_number_offset <= max_number` (otherwise no base number is valid).
- `installment_value * installment_count = simple_bond_value` exactly. `installment_value` is a stored column, not generated: a price that does not divide evenly (60000 in 7 installments) is rejected instead of rounded.

Rules (enforced by triggers for every role, including `service_role`):

- New campaigns start in `draft`.
- Status changes only follow `docs/state-machines.md` (`draft -> active -> closing -> closed`, `draft -> annulled`, `active -> annulled`). Anything else fails with `23514`.
- Activating requires both `starts_at` and `ends_at`; once activated, neither date can be cleared (`23514`).
- Edit windows depend on the status before the update: numbering, installment and `barcode_mode` rules only while `draft`; dates while `draft` or `active`; name until `closed`/`annulled`. Closed and annulled campaigns are immutable. Edits outside the window fail with `55000`.
- `id`, `created_at` and `created_by` never change. `updated_at` is set on every update.
- Several campaigns can be `active` at the same time.
- Campaigns are never deleted (annul instead): no API role has `DELETE`/`TRUNCATE`, and a trigger blocks the owner too.

Access: `authenticated` can only `SELECT`, and RLS limits it to `campaign.view`. Writes go through permission-checked SQL functions that record the change and its audit row in one transaction (SAN-17). `service_role` has `SELECT`, `INSERT` and `UPDATE`.

Write functions (`20261117000000_campaign_rpcs.sql`, SECURITY DEFINER, executable by `authenticated` only; they act as `auth.uid()`'s active profile):

- `campaign_create(p_name, p_simple_bond_value, p_installment_count, p_number_digits, p_max_number, p_associated_number_offset, p_overflow_policy, p_barcode_mode, p_starts_at, p_ends_at, p_request_id, p_reason) returns uuid` (`campaign.create`).
- `campaign_update(p_id, p_name, p_starts_at, p_ends_at, p_request_id, p_reason) returns boolean` (`campaign.update`).
- `campaign_update_rules(p_id, p_simple_bond_value, p_installment_count, p_number_digits, p_max_number, p_associated_number_offset, p_overflow_policy, p_barcode_mode, p_request_id, p_reason) returns boolean` (`campaign.update_rules`; draft only).
- `campaign_transition(p_id, p_to_status, p_reason, p_request_id)`: `active` needs `campaign.update_rules`; `closing`, `closed` and `annulled` need `campaign.close`; annulling needs a reason.

`installment_value` is always computed by these functions (`simple_bond_value / installment_count`, rejected with `22023` unless exact to the cent). Updates are full replacements of their fields; a call that changes nothing returns `false` and writes no audit row. Audit actions: `campaign.create` (new value: full snapshot), `campaign.update` / `campaign.update_rules` (old and new value: only the changed fields), `campaign.transition` (old and new `status`). Errors: `42501` no active profile or permission, `22023` invalid input, `P0002` not found, `23514` / `55000` from the constraints and the write guard above.

### profiles

Represents application users linked to Supabase Auth.

Suggested fields:

- `id`
- `auth_user_id`
- `full_name`
- `email`
- `status`
- `created_at`

Rules:

- Profiles are never hard-deleted. A user is removed by setting `status = 'inactive'` (and banning the Supabase Auth user), so role assignments and audit actors are preserved.
- `auth_user_id` references `auth.users` with `on delete restrict`: deleting an auth user that has a profile (dashboard or `auth.admin.deleteUser`) fails until the profile is handled. User creation does not hard-delete profiles: `admin_provision_profile` creates the profile, roles and audit row atomically, so when provisioning fails nothing is written and the compensation path only deletes the just-created auth user (which has no profile).
- `email` mirrors `auth.users.email` and is kept in sync by a trigger on `auth.users`; uniqueness is case-insensitive (`lower(email)`).

### roles

Application roles.

Initial values:

- `admin`
- `operator`
- `treasurer`
- `collector`
- `read-only`

### permissions

Granular application permissions.

Suggested fields:

- `id`
- `code`
- `description`

Examples:

- `payment.annul`
- `settlement.close`
- `commission.adjust`
- `draw.freeze_roster`

### role_permissions

Relationship between roles and permissions.

Suggested fields:

- `role_id`
- `permission_id`

### user_roles

Relationship between users and roles.

Suggested fields:

- `user_id`
- `role_id`

Rules:

- `user_id` references `profiles` with `on delete restrict` (profiles are deactivated, not deleted).

### collectors

Collectors or sellers.

Suggested fields:

- `id`
- `display_name`
- `phone`
- `email`
- `address`
- `user_profile_id`
- `status`
- `created_at`

### buyers

Buyers.

Suggested fields:

- `id`
- `type`
- `first_name`
- `last_name`
- `business_name`
- `document_number`
- `tax_id`
- `phone`
- `address`
- `usual_collector_id`
- `notes`
- `created_at`

### bonds

Sellable commercial unit: simple bond or pata.

Suggested fields:

- `id`
- `campaign_id`
- `kind`
- `origin`
- `internal_code`
- `barcode`
- `commercial_status`
- `financial_status_snapshot`
- `current_collector_id`
- `current_buyer_id`
- `commercial_unit_count`
- `total_value`
- `created_at`

`kind` values:

- `simple`
- `pata`

`origin` values:

- `printed`
- `manual_grouping`

Rule:

- For simple bond, `commercial_unit_count = 1`.
- For pata, `commercial_unit_count = number of base numbers`.

### bond_numbers

Participating numbers associated with bonds.

Suggested fields:

- `id`
- `campaign_id`
- `bond_id`
- `number_value`
- `number_kind`
- `source_base_number_id`
- `created_at`

`number_kind` values:

- `base`
- `associated`
- `extraordinary`

Critical constraints:

- Unique `(campaign_id, number_value)` to prevent duplicate participating numbers.
- `number_value >= 0`.
- `number_value <= campaign.max_number` must be validated by service or documented trigger, since it crosses campaign configuration.

Notes:

- The visible number is derived from `number_value` and `campaign.number_digits`.
- Do not use `char(4)` or fixed length.

### bond_groups

Tracks the composition of manually assembled patas and their grouping/ungrouping history.

Suggested fields:

- `id`
- `pata_bond_id`
- `member_bond_id`
- `grouped_at`
- `grouped_by`
- `ungrouped_at`
- `ungrouped_by`
- `reason`

Rules:

- Only applies to patas with `origin = manual_grouping`.
- Printed patas do not use this table (their composition is intrinsic).
- A member bond can only belong to one active pata at a time (where `ungrouped_at IS NULL`).
- Ungrouping does not delete the row; it sets `ungrouped_at` and `ungrouped_by` for audit.

### bond_assignments

History of bond delivery, return, and reassignment.

Suggested fields:

- `id`
- `campaign_id`
- `bond_id`
- `collector_id`
- `assignment_type`
- `status`
- `assigned_at`
- `returned_at`
- `created_by`
- `notes`

Types:

- `delivery`
- `return`
- `reassignment`
- `lost`

### delivery_notes

Delivery notes.

Suggested fields:

- `id`
- `campaign_id`
- `note_number`
- `collector_id`
- `status`
- `issued_at`
- `created_by`
- `notes`

### delivery_note_items

Delivery note items.

Suggested fields:

- `delivery_note_id`
- `bond_id`

### sales

Sale of a bond to a buyer.

Suggested fields:

- `id`
- `campaign_id`
- `bond_id`
- `buyer_id`
- `collector_id`
- `sold_at`
- `payment_mode`
- `total_amount`
- `status`
- `created_by`

### payment_plans

Payment plan generated for a sale.

Suggested fields:

- `id`
- `sale_id`
- `installment_count`
- `total_amount`
- `status`

### installments

Installments of the payment plan.

Suggested fields:

- `id`
- `payment_plan_id`
- `installment_number`
- `due_date`
- `amount`
- `status`

Constraints:

- Unique `(payment_plan_id, installment_number)`.

### payments

Recorded payments.

Suggested fields:

- `id`
- `campaign_id`
- `sale_id`
- `collector_id`
- `buyer_id`
- `settlement_id`
- `amount`
- `payment_method`
- `payment_date`
- `status`
- `created_by`
- `created_at`
- `annulled_by`
- `annulled_at`
- `annulment_reason`

Methods:

- `cash`
- `transfer`

States:

- `draft`
- `pending_in_settlement`
- `confirmed`
- `annulled`
- `adjusted`

### payment_installments

Relationship between payments and covered installments.

Suggested fields:

- `payment_id`
- `installment_id`
- `amount_applied`

### settlements

Collector settlements.

Suggested fields:

- `id`
- `campaign_id`
- `settlement_number`
- `collector_id`
- `status`
- `opened_at`
- `closed_at`
- `created_by`
- `closed_by`
- `total_cash`
- `total_transfer`
- `total_amount`
- `commission_amount`
- `commission_paid_amount`
- `net_to_firefighters`
- `notes`

Rule:

- Totals can be saved as a snapshot at closing, but must be reconstructable from payments and entries.

### commission_rules

Commission rules per campaign. Implemented in SAN-20
(`20261118000000_commission_rules.sql`; decisions in `docs/commissions.md`).

Fields:

- `id`
- `campaign_id` (FK `campaigns`)
- `rule_type`: `cash_full_payment`, `installment_first`, `installment_middle`, `installment_last`,
  `custom`
- `installment_number`: required (1..`campaigns.installment_count`) for `custom`, null otherwise
- `percentage` `numeric(5,2)` (0 < p <= 100) or `fixed_amount` `numeric(14,2)` (> 0): exactly one
- `applies_to_collector_id`: null for general rules; no FK until `collectors` exists (Phase 5)
- `valid_from`, `valid_to`: calendar days, both inclusive; `valid_to` null = open-ended
- `status` (`active`, `annulled`), `annulled_at`, `annulled_by`, `annul_reason`
- `created_by`, `created_at`, `updated_at`

Rules:

- Active general rules of the same campaign + `rule_type` (+ `installment_number`) cannot overlap
  in validity (EXCLUDE constraint `commission_rules_no_overlap`, extension `btree_gist`).
- Never deleted: annulled with a reason. Annulled rules are immutable.
- Writable only while the campaign is `draft` or `active`, only through the audited
  `commission_rule_*` functions (`commission.rule_manage`); readable with `commission.view`.

### commission_adjustments

Manual commission adjustments.

Suggested fields:

- `id`
- `campaign_id`
- `collector_id`
- `settlement_id`
- `payment_id`
- `amount`
- `direction`
- `reason`
- `created_by`
- `created_at`

Rule:

- Every adjustment must generate a current account entry and audit.

Types:

- `cash_full_payment`
- `installment_first`
- `installment_middle`
- `installment_last`
- `custom`

### collector_ledger_entries

Collector current account ledger.

Suggested fields:

- `id`
- `campaign_id`
- `collector_id`
- `settlement_id`
- `payment_id`
- `entry_type`
- `direction`
- `amount`
- `status`
- `occurred_at`
- `created_by`
- `reason`

`direction` values:

- `collector_credit`
- `collector_debit`

Rule:

- Collector balance is calculated by summing non-annulled entries.

### draws

Draws.

Suggested fields:

- `id`
- `campaign_id`
- `draw_type`
- `name`
- `draw_date`
- `payment_cutoff_at`
- `required_installment_number`
- `eligibility_rule`
- `status`

Types:

- `monthly`
- `extraordinary_full_payment`
- `final`
- `consolation`

### draw_rosters

Draw rosters.

Suggested fields:

- `id`
- `draw_id`
- `status`
- `generated_at`
- `frozen_at`
- `generated_by`
- `frozen_by`

### draw_roster_entries

Frozen roster entries.

Suggested fields:

- `id`
- `draw_roster_id`
- `bond_id`
- `bond_number_id`
- `number_value`
- `buyer_snapshot`
- `collector_snapshot`
- `eligible`
- `ineligibility_reason`

Rule:

- Save enough snapshots to justify historical results even if current data changes.

### prizes

Draw prizes.

Suggested fields:

- `id`
- `draw_id`
- `name`
- `description`
- `position`
- `status`

### winning_numbers

Loaded winning numbers.

Suggested fields:

- `id`
- `draw_id`
- `prize_id`
- `number_value`
- `matched_roster_entry_id`
- `result_status`
- `loaded_by`
- `loaded_at`
- `notes`

Result states:

- `pending_review`
- `eligible_winner`
- `not_eligible`
- `no_match`

### prize_awards

Administrative prize results.

Suggested fields:

- `id`
- `prize_id`
- `winning_number_id`
- `bond_id`
- `buyer_id`
- `collector_id`
- `status`
- `awarded_at`
- `delivered_at`
- `created_by`
- `notes`

### audit_log

General audit.

Suggested fields:

- `id`
- `actor_user_id`
- `action`
- `entity_type`
- `entity_id`
- `old_value`
- `new_value`
- `reason`
- `created_at`
- `request_id`

Rules:

- Append-only: rows are never updated or deleted.
- `actor_user_id` is nullable for system actions and references `profiles` with `on delete restrict`, so a profile that appears in the audit log cannot be deleted.
- `created_at` is always set by the database (`now()`); `id` and `created_at` cannot be supplied by authenticated clients, and an authenticated insert must use the caller's own active profile as `actor_user_id`.

### import_sessions

Loading sessions by barcode, file, or old system.

Suggested fields:

- `id`
- `campaign_id`
- `source_type`
- `status`
- `created_by`
- `created_at`
- `confirmed_at`
- `notes`

### import_session_items

Items of an import session.

Suggested fields:

- `id`
- `import_session_id`
- `raw_value`
- `parsed_value`
- `barcode`
- `item_type`
- `status`
- `error_message`

### legacy_migration_staging

Staging area for data exported from the old system.

Suggested fields:

- `id`
- `source_file_id`
- `record_type`
- `raw_data`
- `normalized_data`
- `status`
- `error_message`

## Suggested indexes

- `bond_numbers(campaign_id, number_value)` unique.
- `bonds(campaign_id, commercial_status)`.
- `bonds(campaign_id, current_collector_id)`.
- `buyers(document_number)` when it exists.
- `buyers(tax_id)` when it exists.
- `payments(campaign_id, status)`.
- `payments(settlement_id)`.
- `installments(payment_plan_id, installment_number)` unique.
- `collector_ledger_entries(collector_id, campaign_id, occurred_at)`.
- `draw_roster_entries(draw_roster_id, number_value)`.
- `import_sessions(campaign_id, status)`.
- `import_session_items(import_session_id, status)`.
- `bond_groups(pata_bond_id)`.
- `bond_groups(member_bond_id)`.
- `bond_groups(member_bond_id)` where `ungrouped_at IS NULL` (active memberships only).

## Critical integrity rules

- Do not duplicate participating numbers per campaign.
- Do not sell an annulled or lost bond.
- Do not directly reassign a sold bond.
- Do not directly edit closed settlements.
- Do not directly edit confirmed payments.
- Do not recalculate frozen rosters.
- Do not calculate balances from editable manual fields.
- Do not confirm imports with blocking errors.
- Do not apply commission adjustments without reason and audit.
