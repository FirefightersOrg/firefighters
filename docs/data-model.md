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
- `simple_bond_value` (numeric(14,2), > 0, not `NaN`)
- `installment_count` (integer, > 0)
- `installment_value` (numeric(14,2), > 0, not `NaN`): derived, see rules
- `number_digits` (integer, 1 to 10, default 4)
- `max_number` (integer, default 9999)
- `associated_number_offset` (integer, default 4871)
- `overflow_policy` (text, default `reject`; only `reject` for now)
- `barcode_mode` (text, required, no default): `base_number`, `internal_code`, `external_legacy_code`, `manual_mapping`
- `created_by` (profile, nullable for system actions, `on delete restrict`)
- `created_at`, `updated_at` (set by the database)

Constraints:

- `number_digits` between 1 and 10 (`max_number` is an integer, so at most 2147483647: 10 digits), `max_number > 0`, `associated_number_offset >= 0`.
- `simple_bond_value` and `installment_value` are not `NaN`. Postgres `numeric` accepts `'NaN'` and treats it as greater than every number and equal to itself, so it would otherwise pass `> 0` and the exact-installment check; `±Infinity` is already rejected by `numeric(14,2)`.
- `max_number` fits in `number_digits` (`max_number < 10^number_digits`); 5-digit campaigns use `number_digits = 5`, `max_number = 99999`.
- `associated_number_offset <= max_number` (otherwise no base number is valid).
- `installment_value * installment_count = simple_bond_value` exactly. `installment_value` is a stored column, not generated: a price that does not divide evenly (60000 in 7 installments) is rejected instead of rounded.

Rules (enforced by triggers for every role, including `service_role`):

- New campaigns start in `draft`.
- Status changes only follow `docs/state-machines.md` (`draft -> active -> closing -> closed`, `draft -> annulled`, `active -> annulled`). Anything else fails with `23514`.
- Activating requires both `starts_at` and `ends_at`; once activated, neither date can be cleared (`23514`).
- Edit windows depend on the status before the update: numbering, installment and `barcode_mode` rules only while `draft`; dates while `draft` or `active`; name until `closed`/`annulled`. Closed and annulled campaigns are immutable. Edits outside the window fail with `55000`.
- Once a campaign has any bond (annulled ones included), its numbering, value/installment and `barcode_mode` rules are frozen even while `draft` (`campaigns_rules_frozen_with_bonds`, SAN-22; `55000` `campaign rules cannot be changed once the campaign has bonds`). Name and dates keep their normal windows, and the campaign can still be activated.
- `id`, `created_at` and `created_by` never change. `updated_at` is set on every update.
- Several campaigns can be `active` at the same time.
- Campaigns are never deleted (annul instead): no API role has `DELETE`/`TRUNCATE`, and a trigger blocks the owner too.

Access: `authenticated` can only `SELECT`, and RLS limits it to `campaign.view`. Writes go through permission-checked SQL functions that record the change and its audit row in one transaction (SAN-17). `service_role` has `SELECT`, `INSERT` and `UPDATE`.

Write functions (`20261117000000_campaign_rpcs.sql`, SECURITY DEFINER, executable by `authenticated` only; they act as `auth.uid()`'s active profile):

- `campaign_create(p_name, p_simple_bond_value, p_installment_count, p_number_digits, p_max_number, p_associated_number_offset, p_overflow_policy, p_barcode_mode, p_starts_at, p_ends_at, p_request_id, p_reason) returns uuid` (`campaign.create`).
- `campaign_update(p_id, p_name, p_starts_at, p_ends_at, p_expected_updated_at, p_request_id, p_reason) returns boolean` (`campaign.update`).
- `campaign_update_rules(p_id, p_simple_bond_value, p_installment_count, p_number_digits, p_max_number, p_associated_number_offset, p_overflow_policy, p_barcode_mode, p_expected_updated_at, p_request_id, p_reason) returns boolean` (`campaign.update_rules`; draft only).
- `campaign_transition(p_id, p_to_status, p_reason, p_request_id)`: `active` needs `campaign.update_rules`; `closing`, `closed` and `annulled` need `campaign.close`; annulling needs a reason, the other transitions accept an optional one (stored in the audit log).

`installment_value` is always computed by these functions (`simple_bond_value / installment_count`, rejected with `22023` unless exact to the cent). Updates are full replacements of their fields; a call that changes nothing returns `false` and writes no audit row. Audit actions: `campaign.create` (new value: full snapshot), `campaign.update` / `campaign.update_rules` (old and new value: only the changed fields), `campaign.transition` (old and new `status`). Errors: `42501` no active profile or permission, `22023` invalid input, `P0002` not found, `23514` / `55000` from the constraints and the write guard above, `PT409` stale version (below).

Optimistic concurrency: `updated_at` is the campaign's version. `campaign_update` and `campaign_update_rules` require `p_expected_updated_at`, the `updated_at` the caller loaded (no default). After locking the row (and after the permission, input and not-found checks) they compare it exactly with the current `updated_at`; if it differs (or is null) they raise `PT409` (`campaign was modified by someone else`) and write nothing, not even an audit row. `PT409` is PostgREST's custom-status convention (HTTP 409, never retried); `40001` was ruled out because PostgREST retries serialization failures automatically and without limit, so a stale save would never return. The app keeps `updated_at` as the string PostgREST returned (microsecond precision) and sends it back unchanged in the edit forms' hidden `expectedUpdatedAt` field; a conflict is shown as a 409 asking the user to reload. `campaign_transition` takes no version: it validates the current status under the row lock.

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

Sellable commercial unit: simple bond or pata. Implemented in `20261119000000_bonds.sql` (SAN-22).

Fields:

- `id` (uuid)
- `campaign_id` (FK `campaigns`, `on delete restrict`)
- `kind`: `simple`, `pata`
- `origin`: `printed`, `manual_grouping`
- `internal_code`, `barcode` (text, optional; not blank and without surrounding whitespace)
- `commercial_status`: `created`, `available` (default), `delivered_to_collector`, `sold`, `returned`, `lost`, `annulled`, `closed`
- `financial_status_snapshot`: `no_payments` (default), `partial_payments`, `up_to_date`, `overdue`, `fully_paid`, `uncollectible`, `annulled`
- `current_collector_id`, `current_buyer_id` (uuid, nullable): no FK until `collectors` / `buyers` exist (Phase 5)
- `commercial_unit_count` (integer, default 1)
- `total_value` (numeric(14,2), > 0, not `NaN`)
- `annulled_at`, `annulled_by` (profile), `annul_reason`: set together, only when `annulled` (CHECK `bonds_annulment_consistent`)
- `annulled_from_status`: the status the bond was annulled from (`available` or `sold`). Set by the database when the bond is annulled (callers cannot set it), present only when `annulled` (same CHECK), immutable afterwards (`23001`). Decides whether the bond's numbers can be released (see `bond_numbers`)
- `created_by` (profile, nullable for system/import actions), `created_at`, `updated_at` (set by the database)

Rules (constraints and the `bonds_guard_write` trigger, for every role):

- A simple bond is always `printed` and has `commercial_unit_count = 1`. A pata has `commercial_unit_count = N >= 2` (its number of base numbers) and is `printed` or `manual_grouping`.
- `total_value = campaigns.simple_bond_value * commercial_unit_count`, checked on insert (`23514`). The rules it depends on are frozen once the campaign has bonds.
- Bonds are created only while the campaign is `draft` or `active` (`55000` otherwise), in `available` (manual entry of simple bonds and printed patas) or `created` (reserved for Phase 4 imports), with `financial_status_snapshot = no_payments`.
- `commercial_status` changes follow `docs/state-machines.md` (Bond), including `available -> annulled` for a bond loaded by mistake (`23514` otherwise). `annulled_at` and `annulled_from_status` are set by the database.
- `id`, `campaign_id`, `kind`, `origin`, `commercial_unit_count`, `total_value`, `created_at`, `created_by` never change (`23001`).
- `annulled` and `closed` bonds are immutable except for `financial_status_snapshot` (`55000`).
- While a simple bond is an active member of a manual pata (`bond_groups`), its commercial data (status, codes, collector, buyer, annulment) cannot change (`55000`): it is operated through the pata. It keeps its own commercial status; there is no separate "grouped" status.
- A manually grouped pata is sold as a whole: it can only leave `available` (other than by annulment, after ungrouping) with all its members, i.e. `commercial_unit_count` active `bond_groups` rows (`55000` otherwise).
- `barcode` and `internal_code` are unique per campaign among bonds that hold them (partial unique indexes `bonds_campaign_barcode_key`, `bonds_campaign_internal_code_key`, `where commercial_status <> 'annulled' or annulled_from_status is distinct from 'available'`). Same rule as number release: only the codes of a bond annulled by mistake (`annulled_from_status = 'available'`) can be entered again; the codes of a bond annulled from `sold` (annulled sale) stay held (`23505`).
- Bonds are never deleted (annul instead): no API role has `DELETE`/`TRUNCATE`, and a trigger blocks the owner too.

Access: `authenticated` can only `SELECT`, and RLS limits it to `bond.view` (same for `bond_numbers` and `bond_groups`). Writes go through permission-checked, audited SQL functions (SAN-23): creating bonds and grouping/ungrouping manual patas need `bond.create`, annulling needs `bond.annul` (there is no `bond.update` permission). `service_role` has `SELECT`, `INSERT` and `UPDATE`.

### bond_numbers

Participating numbers associated with bonds. Implemented in `20261119000000_bonds.sql` (SAN-22).

Fields:

- `id`
- `campaign_id`, `bond_id`: composite FK to `bonds (id, campaign_id)`, so a number always belongs to its bond's campaign
- `number_value` (integer, >= 0)
- `number_kind`: `base`, `associated`, `extraordinary`
- `source_base_number_id`: for `associated`, the base number it derives from (required, same bond: composite FK to `bond_numbers (id, bond_id)`); null for `base`
- `created_at` (set by the database)
- `released_at`, `released_by` (profile): set together when the number is released (see below)

Rules (constraints and the `bond_numbers_guard_write` trigger):

- `number_value <= campaigns.max_number` (`overflow_policy = reject`), `23514` otherwise.
- `associated` number = its base number + `campaigns.associated_number_offset`; at most one associated number per base.
- A bond has at most `commercial_unit_count` base and `commercial_unit_count` associated numbers (a simple bond: 1 + 1; a printed pata of N: N + N). Extraordinary numbers are not limited.
- A manually grouped pata has no numbers of its own: its members (simple bonds) keep theirs.
- Numbers cannot be added to an annulled bond. Every column but the release is immutable (`23001`); a released number is immutable (`55000`).
- Never deleted.

Uniqueness (deviation from the original design): instead of a plain unique `(campaign_id, number_value)`, uniqueness applies to numbers that were **not released** (partial unique index `bond_numbers_campaign_number_key ... where released_at is null`). When a bond loaded by mistake is annulled, its numbers are released (`released_at`, `released_by`; allowed only once the bond is `annulled` **and** its `annulled_from_status` is `available`, `55000` otherwise): the rows stay as history and the same number can be entered again on a new bond. A bond annulled from `sold` (annulled sale, Phase 10) keeps its numbers held: they are never released and no other bond can take them. A participating number therefore still points to at most one live bond per campaign.

Notes:

- The visible number is derived from `number_value` and `campaign.number_digits`.
- Do not use `char(4)` or fixed length.

### bond_groups

Tracks the composition of manually assembled patas and their grouping/ungrouping history. Implemented in `20261119000000_bonds.sql` (SAN-22).

Fields:

- `id`
- `pata_bond_id`, `member_bond_id` (FK `bonds`)
- `grouped_at` (set by the database), `grouped_by` (profile, required)
- `ungrouped_at` (set by the database), `ungrouped_by` (profile)
- `reason`: the ungrouping reason. Null while the membership is active; required (not blank), together with `ungrouped_at` and `ungrouped_by`, once ungrouped (CHECK `bond_groups_ungrouping_consistent`)

Rules (constraints and the `bond_groups_guard_write` trigger):

- Only applies to patas with `kind = pata`, `origin = manual_grouping`. Members are simple bonds of the same campaign.
- Printed patas do not use this table (their composition is intrinsic: they own their numbers).
- Both the pata and the member must be `available` to group; a pata has at most `commercial_unit_count` active members.
- A member bond can only belong to one active pata at a time (partial unique index on `member_bond_id` where `ungrouped_at IS NULL`).
- Ungrouping does not delete the row; it sets `ungrouped_at`, `ungrouped_by` and `reason`. Only an `available` pata can be ungrouped (`55000` for `delivered_to_collector`, `returned`, `sold`, etc.). The guard locks the pata row (`FOR UPDATE`) before checking its status, so an ungrouping and a concurrent status change of the pata serialize: whichever commits first wins and the other fails (a pata never leaves `available` without its members). Ungrouped rows are immutable; the composition columns never change.

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
- `percentage` `numeric(5,2)` (0 < p <= 100) or `fixed_amount` `numeric(14,2)` (> 0, not `NaN`): exactly one
- `applies_to_collector_id`: null for general rules; no FK until `collectors` exists (Phase 5)
- `valid_from`, `valid_to`: calendar days, both inclusive; `valid_to` null = open-ended
- `status` (`active`, `annulled`), `annulled_at`, `annulled_by`, `annul_reason`
- `created_by`, `created_at`, `updated_at`

Rules:

- Active general rules of the same campaign + `rule_type` (+ `installment_number`) cannot overlap
  in validity (EXCLUDE constraint `commission_rules_no_overlap`, extension `btree_gist`).
- Never deleted: annulled with a reason. An annulled rule always records `annulled_at`,
  `annulled_by` and a non-blank `annul_reason`, an active one none of them (CHECK
  `commission_rules_annulment_consistent`). Annulled rules are immutable.
- Writable only while the campaign is `draft` or `active`, only through the audited
  `commission_rule_*` functions (`commission.rule_manage`); readable with `commission.view`.
- The functions reject `NaN` and `±Infinity` values with `22023` (their parameters are
  unconstrained `numeric`); the table CHECKs reject `NaN` too.
- Optimistic concurrency, same as campaigns: `commission_rule_update(p_id, p_rule_type,
p_installment_number, p_percentage, p_fixed_amount, p_valid_from, p_valid_to,
p_expected_updated_at, p_request_id, p_reason)` requires the rule's `updated_at` as loaded and
  raises `PT409` (HTTP 409 through PostgREST) without writing (no audit row) if the rule changed
  since. `p_valid_to` has no
  default (pass null for open-ended). `commission_rule_annul` takes no version.

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

- `bond_numbers(campaign_id, number_value)` unique where `released_at IS NULL` (numbers of annulled bonds are released).
- `bonds(campaign_id, barcode)` and `bonds(campaign_id, internal_code)` unique except for bonds annulled from `available` (codes of an annulled sale stay held).
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
