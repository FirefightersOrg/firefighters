# Preliminary Data Model

## Objective

Define the conceptual relational model for the MVP. Names are preliminary and must later be converted into versioned SQL migrations.

## Principles

- PostgreSQL will be the source of truth.
- Use real foreign keys.
- Use constraints for critical invariants.
- Do not delete historical financial data.
- Model balances as entries, not editable fields.
- Separate internal value from visible format in bond numbers.
- Keep rules configurable per campaign.

## Main Entities

### campaigns

Represents an annual campaign.

Suggested fields:

- `id`
- `name`
- `status`
- `starts_at`
- `ends_at`
- `simple_bond_value`
- `installment_count`
- `installment_value`
- `number_digits`
- `max_number`
- `associated_number_offset`
- `overflow_policy`
- `barcode_mode`
- `created_at`
- `updated_at`

Suggested constraints:

- `number_digits > 0`
- `max_number > 0`
- `associated_number_offset >= 0`
- `overflow_policy in ('reject')` initially

### profiles

Represents application users linked to Supabase Auth.

Suggested fields:

- `id`
- `auth_user_id`
- `full_name`
- `email`
- `status`
- `created_at`

### roles

Application roles.

Initial values:

- `admin`
- `operador`
- `tesorero`
- `cobrador`
- `consulta`

### permissions

Granular application permissions.

Suggested fields:

- `id`
- `code`
- `description`

Examples:

- `payment.annul`
- `rendition.close`
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

Sellable commercial unit: simple bond or pata (multi-number bond/package).

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

Values for `kind`:

- `simple`
- `pata`

Values for `origin`:

- `printed`
- `manual_grouping`

Rule:

- For a simple bond, `commercial_unit_count = 1`.
- For a pata, `commercial_unit_count = number of base numbers`.

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

Values for `number_kind`:

- `base`
- `associated`
- `extraordinary`

Critical constraints:

- Unique `(campaign_id, number_value)` to avoid duplicate participating numbers.
- `number_value >= 0`.
- `number_value <= campaign.max_number` must be validated by a service or documented trigger, because it crosses against campaign configuration.

Notes:

- The visible number is derived from `number_value` and `campaign.number_digits`.
- Do not use `char(4)` or fixed length.

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

Payment plan installments.

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

Registered payments.

Suggested fields:

- `id`
- `campaign_id`
- `sale_id`
- `collector_id`
- `buyer_id`
- `rendition_id`
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

Statuses:

- `draft`
- `pending_in_rendition`
- `confirmed`
- `annulled`
- `adjusted`

### payment_installments

Relationship between payments and covered installments.

Suggested fields:

- `payment_id`
- `installment_id`
- `amount_applied`

### renditions

Collector settlements.

Suggested fields:

- `id`
- `campaign_id`
- `rendition_number`
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

- Totals may be stored as a snapshot at closing, but they must be reconstructable from payments and entries.

### commission_rules

Commission rules by campaign.

Suggested fields:

- `id`
- `campaign_id`
- `rule_type`
- `installment_number`
- `percentage`
- `fixed_amount`
- `applies_to_collector_id`
- `valid_from`
- `valid_to`

### commission_adjustments

Manual commission adjustments.

Suggested fields:

- `id`
- `campaign_id`
- `collector_id`
- `rendition_id`
- `payment_id`
- `amount`
- `direction`
- `reason`
- `created_by`
- `created_at`

Rule:

- Every adjustment must generate a collector ledger entry and audit.

Types:

- `cash_full_payment`
- `installment_first`
- `installment_middle`
- `installment_last`
- `custom`

### collector_ledger_entries

Collector ledger.

Suggested fields:

- `id`
- `campaign_id`
- `collector_id`
- `rendition_id`
- `payment_id`
- `entry_type`
- `direction`
- `amount`
- `status`
- `occurred_at`
- `created_by`
- `reason`

Values for `direction`:

- `collector_credit`
- `collector_debit`

Rule:

- The collector balance is calculated by summing non-annulled entries.

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

Frozen draw roster entries.

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

- Save enough snapshots to justify the historical result even if current data changes.

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

Result statuses:

- `pending_review`
- `eligible_winner`
- `not_eligible`
- `no_match`

### prize_awards

Administrative prize result.

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

### import_sessions

Load sessions by barcode, file, or old system.

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

Items in an import session.

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

## Suggested Indexes

- `bond_numbers(campaign_id, number_value)` unique.
- `bonds(campaign_id, commercial_status)`.
- `bonds(campaign_id, current_collector_id)`.
- `buyers(document_number)` when present.
- `buyers(tax_id)` when present.
- `payments(campaign_id, status)`.
- `payments(rendition_id)`.
- `installments(payment_plan_id, installment_number)` unique.
- `collector_ledger_entries(collector_id, campaign_id, occurred_at)`.
- `draw_roster_entries(draw_roster_id, number_value)`.
- `import_sessions(campaign_id, status)`.
- `import_session_items(import_session_id, status)`.

## Critical Integrity Rules

- Do not duplicate participating numbers per campaign.
- Do not sell an annulled or lost bond.
- Do not directly reassign a sold bond.
- Do not directly edit closed collector settlements.
- Do not directly edit confirmed payments.
- Do not recalculate frozen draw rosters.
- Do not calculate balances from editable manual fields.
- Do not confirm imports with blocking errors.
- Do not apply commission adjustments without reason and audit.
