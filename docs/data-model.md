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

## Function privileges

Since `20261210000000_revoke_default_function_execute.sql` (SAN-102), a function that a migration creates is executable only by its owner (`postgres`). Its default privileges no longer grant `EXECUTE` to `PUBLIC` (in any schema) or to `anon`, `authenticated` and `service_role` (in `public`). An RPC the app calls is unreachable until the migration grants it:

```sql
grant execute on function public.my_rpc(uuid, text) to authenticated;
```

- Every new RPC needs an explicit `grant execute ... to authenticated` (or `to service_role` for server-only functions). Internal helpers and trigger functions get no grant: triggers and `SECURITY DEFINER` callers do not need one.
- Keep the explicit `revoke all on function ... from public, anon, authenticated, service_role` before the grant anyway. It documents intent and keeps working if the function already existed with other privileges (`create or replace` keeps the old ACL).
- Functions created before this migration keep the ACLs their migrations set.
- Only `postgres`'s defaults are changed. Migrations run as `postgres`, which cannot change `supabase_admin`'s defaults, so functions created by `supabase_admin` (platform internals, extensions) keep the platform defaults.
- pgTAP helpers in `pg_temp` are also created without `PUBLIC` `EXECUTE`. Grant them to the roles the test switches to (`grant execute on function pg_temp.act_as(int) to authenticated, anon;`).
- pgTAP `024_default_function_privileges.test.sql` checks the default ACLs and that a new function cannot be called without a grant.

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
- `associated_number_mode` (text, default `linear`; SAN-151, `20270123000000_circular_offset_mode.sql`): `linear` (`N2 = base + offset`) or `circular` (`N2 = B + ((base + offset) mod B)`, `B = (max_number + 1) / 2`)
- `overflow_policy` (text, default `reject`; only `reject` for now)
- `barcode_mode` (text, required, no default): `base_number`, `internal_code`, `external_legacy_code`, `manual_mapping` (semantics in `docs/imports.md`)
- `barcode_pattern` (text, optional, SAN-44): only for `internal_code` / `external_legacy_code`; a Postgres regular expression whose first capture group is the base number (null: the operator types the base number, like `manual_mapping`)
- `overdue_warning_threshold` (integer 1..120, default 3, SAN-142): reports warn about a sale with this many overdue installments or more. Informative only.
- `created_by` (profile, nullable for system actions, `on delete restrict`)
- `created_at`, `updated_at` (set by the database)

Constraints:

- `number_digits` between 1 and 10 (`max_number` is an integer, so at most 2147483647: 10 digits), `max_number > 0`, `associated_number_offset >= 0`.
- `simple_bond_value` and `installment_value` are not `NaN`. Postgres `numeric` accepts `'NaN'` and treats it as greater than every number and equal to itself, so it would otherwise pass `> 0` and the exact-installment check; `±Infinity` is already rejected by `numeric(14,2)`.
- `max_number` fits in `number_digits` (`max_number < 10^number_digits`); 5-digit campaigns use `number_digits = 5`, `max_number = 99999`.
- `associated_number_offset <= max_number` (otherwise no base number is valid).
- `associated_number_mode in ('linear', 'circular')` (`campaigns_associated_number_mode_check`). Circular mode (SAN-151) also needs `max_number + 1` even, so `2 x B = max_number + 1` (`campaigns_circular_max_number_even_range`), and `associated_number_offset < B` (`campaigns_circular_offset_below_block`). The mode is a rule: editable only in draft (`campaigns_guard_write`) and frozen once the campaign has bonds (`campaigns_rules_frozen_with_bonds`).
- `barcode_pattern` (SAN-44, `20261123000000_campaign_barcode_pattern.sql`): at most 200 characters, not blank, no surrounding whitespace (`campaigns_barcode_pattern_format`); null unless `barcode_mode` is `internal_code` or `external_legacy_code` (`campaigns_barcode_pattern_mode`); compiles as a Postgres (ARE) regex with at least one capture group (`campaigns_barcode_pattern_valid`, via `campaign_barcode_pattern_valid()`; embedded options such as a leading `(?i)` are not supported).
- `installment_value * installment_count = simple_bond_value` exactly. `installment_value` is a stored column, not generated: a price that does not divide evenly (60000 in 7 installments) is rejected instead of rounded.

Rules (enforced by triggers for every role, including `service_role`):

- New campaigns start in `draft`.
- Status changes only follow `docs/state-machines.md` (`draft -> active -> closing -> closed`, `draft -> annulled`, `active -> annulled`). Anything else fails with `23514`.
- Activating requires both `starts_at` and `ends_at`; once activated, neither date can be cleared (`23514`).
- Edit windows depend on the status before the update: numbering, installment, `barcode_mode` and `barcode_pattern` rules only while `draft`; dates while `draft` or `active`; name until `closed`/`annulled`. Closed and annulled campaigns are immutable. Edits outside the window fail with `55000`.
- Once a campaign has any bond (annulled ones included), its numbering, value/installment, `barcode_mode` and `barcode_pattern` rules are frozen even while `draft` (`campaigns_rules_frozen_with_bonds`, SAN-22; `55000` `campaign rules cannot be changed once the campaign has bonds`). Name and dates keep their normal windows, and the campaign can still be activated.
- `id`, `created_at` and `created_by` never change. `updated_at` is set on every update.
- Several campaigns can be `active` at the same time.
- Campaigns are never deleted (annul instead): no API role has `DELETE`/`TRUNCATE`, and a trigger blocks the owner too.

Access: `authenticated` can only `SELECT`, and RLS limits it to `campaign.view`. Writes go through permission-checked SQL functions that record the change and its audit row in one transaction (SAN-17). `service_role` has `SELECT`, `INSERT` and `UPDATE`.

Write functions (`20261117000000_campaign_rpcs.sql`, SECURITY DEFINER, executable by `authenticated` only; they act as `auth.uid()`'s active profile):

- `campaign_create(p_name, p_simple_bond_value, p_installment_count, p_number_digits, p_max_number, p_associated_number_offset, p_overflow_policy, p_barcode_mode, p_starts_at, p_ends_at, p_request_id, p_reason, p_barcode_pattern, p_associated_number_mode) returns uuid` (`campaign.create`; `p_associated_number_mode` is the last parameter, default `linear`).
- `campaign_update(p_id, p_name, p_starts_at, p_ends_at, p_expected_updated_at, p_request_id, p_reason) returns boolean` (`campaign.update`).
- `campaign_update_rules(p_id, p_simple_bond_value, p_installment_count, p_number_digits, p_max_number, p_associated_number_offset, p_overflow_policy, p_barcode_mode, p_expected_updated_at, p_request_id, p_reason, p_barcode_pattern, p_associated_number_mode) returns boolean` (`campaign.update_rules`; draft only; the mode is part of the full replacement and of the audit diff).
- `p_barcode_pattern` (SAN-44) is the last parameter, default null, so existing positional callers keep working. It is trimmed (blank = null) and validated with `22023` (`barcode pattern is only used with the internal code or external legacy code barcode modes`, `... must be at most 200 characters`, `... must be a valid regular expression with a capture group for the base number`). `campaign_update_rules` is still a full replacement: omitting the pattern clears it.
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

Implemented in SAN-49 (`20261203000000_collectors_buyers.sql`, pgTAP `019`):

- Global, not per campaign (the same people sell year after year). Never deleted: `status` is `active` or `inactive`; DELETE/TRUNCATE are rejected for every role (`23001`).
- Text is stored trimmed (empty → null); `email` lowercased and checked; limits: name 200, phone 50, email 254, address 500.
- `user_profile_id` (optional, unique) links the future collector login: that profile reads its own row without `collector.view` ("own" scope).
- Writes only through `collector_create` / `collector_update` (`collector.manage`, audited as `collector.create` / `collector.update` with the changed keys; `collector_update` takes `p_expected_updated_at`, `PT409` when stale, and returns false for a no-op).
- RLS: SELECT with `collector.view` or `collector.manage`, or the own row. `bonds.current_collector_id` and `commission_rules.applies_to_collector_id` now reference it.

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

Implemented in SAN-49 (same migration):

- Global and never deleted. `type` is `individual` (needs a first or last name) or `business` (needs `business_name`). Limits: names 100/200, document and tax id 30, notes 2000.
- `document_number` and `tax_id` have partial indexes but are **not unique**: legacy data has duplicate buyers that are normalised by hand, so the screens warn about possible duplicates instead.
- `usual_collector_id` references `collectors` (any status, so it can stay as history).
- Writes only through `buyer_create` / `buyer_update` (`buyer.manage`, audited as `buyer.create` / `buyer.update`, same concurrency rule as collectors).
- RLS: SELECT with `buyer.view` or `buyer.manage` (SAN-93 gives every action permission its `.view`). `bonds.current_buyer_id` now references it.
- App layer: `src/lib/domain/parties.ts`, `src/lib/server/repositories/parties.ts` (list/search/get), `src/lib/server/services/parties.ts` (writes).

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
- `import_session_id` (SAN-44, nullable): the import session that created the bond (null for manual entry). Composite FK `(import_session_id, campaign_id)` to `import_sessions (id, campaign_id)`, so the session belongs to the bond's campaign. Set only on insert, and only while the session is `validated` (`55000` otherwise); immutable (`23001`, trigger `bonds_guard_write_import_session`). The rollback of an import (SAN-47) finds its bonds through it.

Rules (constraints and the `bonds_guard_write` trigger, for every role):

- A simple bond is always `printed` and has `commercial_unit_count = 1`. A pata has `commercial_unit_count = N >= 2` (its number of base numbers) and is `printed` or `manual_grouping`.
- `total_value = campaigns.simple_bond_value * commercial_unit_count`, checked on insert (`23514`). The rules it depends on are frozen once the campaign has bonds.
- Bonds are created only while the campaign is `draft` or `active` (`55000` otherwise), in `available` (manual entry of simple bonds and printed patas, and every bond created by an import), with `financial_status_snapshot = no_payments`. A bond with `import_session_id` cannot start in `created` (`23514`): `created` is reserved for future phases, not for imports.
- `commercial_status` changes follow `docs/state-machines.md` (Bond), including `available -> annulled` for a bond loaded by mistake (`23514` otherwise). `annulled_at` and `annulled_from_status` are set by the database.
- `id`, `campaign_id`, `kind`, `origin`, `commercial_unit_count`, `total_value`, `created_at`, `created_by` never change (`23001`).
- `annulled` and `closed` bonds are immutable except for `financial_status_snapshot` (`55000`).
- While a simple bond is an active member of a manual pata (`bond_groups`), its commercial data (status, codes, collector, buyer, annulment) cannot change (`55000`): it is operated through the pata. It keeps its own commercial status; there is no separate "grouped" status.
- A manually grouped pata is sold as a whole: it can only leave `available` (other than by annulment, after ungrouping) with all its members, i.e. `commercial_unit_count` active `bond_groups` rows (`55000` otherwise).
- `barcode` and `internal_code` are unique per campaign among bonds that hold them (partial unique indexes `bonds_campaign_barcode_key`, `bonds_campaign_internal_code_key`, `where commercial_status <> 'annulled' or annulled_from_status is distinct from 'available'`). Same rule as number release: only the codes of a bond annulled by mistake (`annulled_from_status = 'available'`) can be entered again; the codes of a bond annulled from `sold` (annulled sale) stay held (`23505`).
- Bonds are never deleted (annul instead): no API role has `DELETE`/`TRUNCATE`, and a trigger blocks the owner too.

Access: `authenticated` can only `SELECT`, and RLS limits it to `bond.view` (same for `bond_numbers` and `bond_groups`). Writes go through permission-checked, audited SQL functions (SAN-23, below): creating bonds and grouping/ungrouping manual patas need `bond.create`, annulling needs `bond.annul` (there is no `bond.update` permission). `service_role` has `SELECT`, `INSERT` and `UPDATE`.

#### Bond write functions

`20261120000000_bond_rpcs.sql` (SAN-23). SECURITY DEFINER with an empty `search_path`, executable by `authenticated` only; they act as `auth.uid()`'s active profile. Each one, in one transaction: resolves the actor (`current_profile_id()`), checks the permission (`has_permission()`), locks the campaign `FOR SHARE` (so it serializes against `campaign_update_rules` / `campaign_transition`, which lock `FOR UPDATE`) and then the bonds involved, validates, writes, and inserts exactly one `audit_log` row. A rejected call writes nothing. All four only work while the campaign is `draft` or `active` (`55000` otherwise).

- `bond_create(p_campaign_id, p_base_numbers integer[], p_internal_code, p_barcode, p_request_id, p_reason) returns uuid` (`bond.create`): one base number creates a simple bond, N >= 2 a printed pata. Kind, `commercial_unit_count = N`, the associated numbers (`base + associated_number_offset`) and `total_value = simple_bond_value * N` are computed from the campaign; the client only sends base numbers and optional codes (trimmed, blank = none). The bond starts `available`. Rejected with `22023`: no/null/negative base numbers, a number above `max_number`, an associated number above `max_number` (overflow, `reject` policy), or a number repeated inside the bond (two equal bases, a base equal to another base's associated number, or a base equal to its own associated number when the offset is 0). Audit `bond.create` (new value: snapshot with the numbers).
- `bond_group_into_pata(p_campaign_id, p_member_bond_ids uuid[], p_internal_code, p_barcode, p_request_id, p_reason) returns uuid` (`bond.create`): manual pata (`origin = manual_grouping`, no numbers of its own) from N >= 2 distinct simple bonds of that campaign that are `available` and not active members of another pata. Total `simple_bond_value * N`, status `available`, one `bond_groups` row per member. Members keep their numbers and status. Members are locked in id order. Audit `bond.group` (new value: snapshot with the members).
- `bond_ungroup_pata(p_pata_bond_id, p_reason, p_request_id)` (`bond.create`, reason required): only for an `available` manual pata. Every active membership row gets `ungrouped_at`, `ungrouped_by` and the reason (never deleted), and the pata is annulled (`available -> annulled`) with the same reason; its members are free again. Audit `bond.ungroup` (old/new: status and members).
- `bond_annul(p_bond_id, p_reason, p_request_id)` (`bond.annul`, admin only in the seed; reason required): only for an `available` simple bond or printed pata that is not an active member of a manual pata. Sets the annulment columns (the guard records `annulled_from_status = available`) and releases every live number of the bond (`released_at`, `released_by`) so they can be entered again. A manual pata is not annulled directly (`55000`, ungroup it). Annulling sold bonds is Phase 10. Audit `bond.annul` (old/new: status and the released numbers).

Duplicates: participating numbers are checked by the unique index itself (the insert is attempted and a `unique_violation` is caught and re-raised), so the check also holds under concurrent inserts. The error is `23505` with the message `number 0068 is already used by bond <id>` (the lowest conflicting number, padded to the campaign's digits) and a JSON `DETAIL` listing every conflict: `{"conflicts":[{"number":68,"formatted":"0068","bond_id":"…","number_kind":"base"}, …]}`. Duplicate codes raise `23505` `internal code X is already used by bond <id>` / `barcode X is already used by bond <id>` with `{"internal_code"|"barcode": …, "bond_id": …}` in `DETAIL`.

Errors: `42501` no active profile or permission, `22023` invalid input (above; also fewer than 2 / repeated / null members, a member of another campaign or not simple, ungrouping something that is not a manual pata, missing reason), `P0002` campaign or bond not found, `23505` duplicate number or code, `55000` campaign not draft/active, bond or pata not `available`, member already grouped, annulling a grouped member or a manual pata; the SAN-22 constraints and triggers remain as backstops (`23514`, `23001`).

App layers: `src/lib/domain/bonds.ts` (pure rules: participating numbers, intra-bond collisions, campaign conflicts, composition and value, manual grouping), `src/lib/schemas/bond.ts` (Zod form schemas), `src/lib/server/repositories/bonds.ts` (`getBondById` with numbers and active group membership, `listBondNumbersByCampaign`), `src/lib/server/services/bonds.ts` (`createBond`, `groupBondsIntoPata`, `ungroupPata`, `annulBond`; SQLSTATEs mapped to `BondServiceError` kinds with HTTP statuses, duplicate conflicts parsed from `DETAIL`).

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
- `barcode` (text, optional, SAN-44): the barcode of an imported row, kept with its base number (only `base` numbers, CHECK `bond_numbers_barcode_base_only`; not blank, no surrounding whitespace). An imported pata stores its `grupo_pata` as the pata bond's `barcode` and each row's barcode here. Immutable (`23001`)

Rules (constraints and the `bond_numbers_guard_write` trigger):

- `number_value <= campaigns.max_number` (`overflow_policy = reject`), `23514` otherwise.
- `associated` number = `public.bond_associated_number(base, offset, max_number, mode)` (SAN-151): the base number + `campaigns.associated_number_offset` in `linear` mode, `B + ((base + offset) mod B)` in `circular` mode (B = (max_number + 1) / 2, bases `0..B-1`, so the associated numbers cover `B..2B-1` exactly once and, with the bases, the whole range `0..2B-1` without collisions). One immutable SQL function is the only formula: `bond_numbers_guard_write`, `bond_validate_base_numbers`, `bond_create` and the import staging/confirmation call it; `numbering.ts` (`associatedNumberFor`) mirrors it. At most one associated number per base.
- A bond has at most `commercial_unit_count` base and `commercial_unit_count` associated numbers (a simple bond: 1 + 1; a printed pata of N: N + N). Extraordinary numbers are not limited.
- A manually grouped pata has no numbers of its own: its members (simple bonds) keep theirs.
- Numbers cannot be added to an annulled bond. Every column but the release is immutable (`23001`); a released number is immutable (`55000`).
- Never deleted.

Uniqueness (deviation from the original design): instead of a plain unique `(campaign_id, number_value)`, uniqueness applies to numbers that were **not released** (partial unique index `bond_numbers_campaign_number_key ... where released_at is null`). When a bond loaded by mistake is annulled, its numbers are released (`released_at`, `released_by`; allowed only once the bond is `annulled` **and** its `annulled_from_status` is `available`, `55000` otherwise): the rows stay as history and the same number can be entered again on a new bond. A bond annulled from `sold` (annulled sale, Phase 10) keeps its numbers held: they are never released and no other bond can take them. A participating number therefore still points to at most one live bond per campaign.

Barcode namespace (SAN-44): a barcode identifies at most one live thing per campaign, across `bonds.barcode` and `bond_numbers.barcode`. Live means, for a bond, not annulled from `available` (the predicate of `bonds_campaign_barcode_key`) and, for a number, not released (partial unique index `bond_numbers_campaign_barcode_key ... where barcode is not null and released_at is null`). Across the two tables the triggers `bonds_guard_write_barcode` / `bond_numbers_guard_write_barcode` (`campaign_barcode_guard()`) take a transaction advisory lock on (campaign, barcode) and look for a live holder in the other table, so concurrent writers serialize; a conflict is `23505` `barcode X is already used by bond <id>` (constraint `campaign_barcode_unique`, `DETAIL` `{"barcode": …, "bond_id": …}`). `bond_create` / `bond_group_into_pata` report it like any duplicate barcode (`bond_raise_duplicate` also looks among bond numbers). Freeing follows the number-release rule: codes of a bond annulled from `available` and of released numbers can be used again; codes of a bond annulled from `sold` stay held.

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
- Through the app (`bond_ungroup_pata`, SAN-23) ungrouping also annuls the pata with the same reason, so the members are free again.

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

Implemented in SAN-53/54 (`20261204000000_bond_delivery.sql`, pgTAP `020`):

- `bond_assignments` is the custody history. A `delivery` or `reassignment` row is the bond's custody while `active` (at most one active row per bond, unique index); it is closed as `returned`, `reassigned` or `lost` (the only update allowed, `returned_at` set by the database). `return` and `lost` rows are events; a loss stores `responsible_party`, `lost_on` and the reason in `notes`, and its `collector_id` is null when the bond was never delivered.
- `delivery_notes` are numbered per campaign (`note_number`, serialised with an advisory lock) and record `reason` (`delivery` or `reassignment`: a reassignment issues a note for the new collector). Notes and their items are immutable; annulling a note is Phase 10.
- Composite FKs keep notes, items, assignments and bonds in the same campaign. Nothing is deleted (`23001`).
- Writes only through `bond_deliver` / `bond_reassign` (`bond.assign`), `bond_return` (`bond.return`: `delivered_to_collector → returned → available`, collector cleared) and `bond_mark_lost` (`bond.mark_lost`: available or delivered → `lost`, collector cleared; responsible party, a non-future date and a reason are required). A sold bond is never returned, reassigned or marked lost here (`55000`). Each bond change audits `bond.deliver` / `bond.reassign` / `bond.return` / `bond.mark_lost`, and each note `delivery_note.issue`.
- RLS: readable with `bond.view` or a delivery permission; a collector's own login sees what was handed to it. With today's matrix the operator assigns (`bond.assign`) but returns and losses are admin-only.
- App layer: `src/lib/domain/deliveries.ts`, `src/lib/server/repositories/deliveries.ts`, `src/lib/server/services/deliveries.ts`.

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
- `uncollectible_at`, `uncollectible_by`, `uncollectible_reason`: the manual, final uncollectible
  mark (SAN-106). All three are set together by `sale_mark_uncollectible`, or all are null.

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

Rules (SAN-58, `20261205000000_sales.sql`):

- A bond has at most one `active` sale (`sales.status`: `active`, `annulled`, `corrected`); a
  sale's bond belongs to the sale's campaign. `payment_mode` is `full_payment` (a one-installment
  plan) or `installments`. A sale has at most one `active` payment plan (1 to 120 installments).
- New rows start `active` (installments `pending`). After that only the status changes: sale
  `active -> annulled | corrected`, plan `active -> annulled`, installments as in
  `docs/state-machines.md` "Installment". Amounts, dates and parties never change.
- Nothing is deleted. Writes go through audited functions (`sale.create`, SAN-59; `sale.correct`,
  Phase 10). Readers: `bond.view`, `sale.create`, `sale.correct`, and a collector's own login for
  its sales.

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

Implemented in SAN-62 (`20261214000000_payments_settlements.sql`):

- A payment belongs to the same campaign as its sale and, when present, its settlement (composite
  foreign keys). Its amount, method, date, sale, buyer and collector are immutable; corrections
  annul the payment and create a replacement.
- New payments are `draft` or `pending_in_settlement`; transitions are `draft ->
 pending_in_settlement -> confirmed|annulled` and `confirmed -> annulled|adjusted`. Annulment
  requires actor, timestamp and a trimmed non-blank reason. Drafts have no settlement, while
  pending payments require an open settlement of their collector; confirmed payments retain it.
- Payment dates default to the current date in `America/Argentina/Buenos_Aires`.
- Payments are applied to installments through `payment_installments`. An application must target
  the active payment plan of the payment's sale, is immutable, and non-annulled applications can
  never exceed the installment amount.
- Payment readers need `payment.view` (or a payment action permission), and a collector login can
  read its own payments. Direct writes are revoked; SAN-63 supplies audited write functions.

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

Implemented in SAN-62:

- Settlement numbers are unique per campaign; a settlement is tied to one collector and campaign.
  Totals are non-negative and `total_amount` equals `total_cash + total_transfer`; notes are trimmed non-blank text of at most 2,000 characters, and
  changes to totals are permitted only while it is `open`. The SAN-63 write functions compute
  settlement totals from payments and applications; users do not enter totals.
- Statuses follow `open -> closed|annulled` and `closed -> corrected`; closing records `closed_at`
  and `closed_by`. Closed, annulled and corrected settlements are otherwise immutable.
- Readers need `settlement.view` (or a settlement action permission), and a collector login can
  read its own settlements. Nothing in this financial history can be deleted or truncated.
- A payment's `annulment_reason` is trimmed non-blank text of at most 1,000 characters, the same
  limit as `audit_log.reason` (SAN-97), because the audited annulment copies it there.

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
- Implemented in SAN-67 (`20261216000000_commission_ledger.sql`): adjustments are immutable,
  direct DML is revoked, and future SAN-68/69 audited functions will check
  `commission.adjust` / `commission.settle` / `collector.ledger.adjust`. `amount` is positive
  `numeric(12,2)` (not `NaN`), the required reason is trimmed, non-blank and at most 1,000
  characters, and `direction` is `in_favor_of_collector` or `in_favor_of_firefighters`.
  Optional settlement and payment references are checked to belong to the adjustment's campaign
  and collector. Readers need `commission.view`, `commission.adjust`, or `commission.settle`.

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
- Implemented in SAN-67 (`20261216000000_commission_ledger.sql`): entries are append-only.
  Their amount is positive `numeric(12,2)` (not `NaN`); their seven types and the three statuses
  are defined in `docs/state-machines.md`. A recorded entry can only become `annulled` (with
  actor, timestamp and a required trimmed `annul_reason`, at most 1000 characters) or `compensated`.
  The original `reason` is immutable, including during annulment; `annul_reason`, `annulled_by`
  and `annulled_at` must all be null for non-annulled entries. All historical fields are
  immutable. Optional settlement/payment references must match the entry campaign and collector.
  Readers need `collector.ledger.view` or `collector.ledger.adjust`, while a collector login can
  read only its own rows. Future SAN-68/69 audited functions own all writes.
- SAN-107/108 (`20270113000000_ledger_memo_entries.sql`): `affects_balance boolean` (false only for
  the `cash_settled` / `transfer_received_by_firefighters` reference entries and their annulments,
  which every balance leaves out) and `original_entry_id` (the entry a compensation offsets: same
  campaign and collector, opposite direction, never more than what is left of it). See
  `docs/commissions.md`.

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

#### SAN-75 storage decisions

Implemented by `20261223000000_draws.sql`, pgTAP `037`, and `src/lib/domain/draws.ts`.
No write RPC is introduced: all API roles (including service_role) lack DML; future audited
SECURITY DEFINER RPCs must write the audit row in the same transaction.

- Draw names are trimmed, non-blank, at most 200 Unicode code points. Monthly draws require
  an installment; any non-null installment is in 1..campaign.installment_count. Other types may
  supply one (notably consolation) or leave it null. Eligibility configuration is a JSON object,
  default `{}`: draw type and installment define the documented baseline, while future generation
  code interprets optional configuration for consolation exclusions/extraordinary numbers. This
  migration does not compute eligibility, generate extra numbers, or validate a configuration schema.
- Draws start scheduled and follow exactly the Draw state machine. Only scheduled rules can be
  edited. Closed and annulled rows are wholly immutable. Scheduled annulment requires
  `annulled_at`, `annulled_by`, and a separate trimmed non-blank `annul_reason` (1000 code points).
  Dates are calendar dates; cutoff is an absolute timestamptz. No undocumented cutoff/date ordering
  or prohibition on historical draws is imposed.
- The docs do not specify roster states: choose `generated -> frozen | superseded`, both terminal.
  Regeneration supersedes the generated row and creates a new row; it never deletes history.
  A frozen roster cannot even become superseded. One frozen roster per draw is enforced by a
  partial unique index. Freeze actor and timestamp exist iff frozen. Multiple generated rows are
  allowed so a future transactional generation RPC can publish a replacement.
- Entries are editable only under a generated roster, never moved between rosters. A trigger
  verifies the bond, bond-number identity, stored number value, and draw all match one campaign
  on INSERT and UPDATE. Immutable draw/roster campaign ancestry prevents later mismatches.
  Both `(draw_roster_id, bond_number_id)` and `(draw_roster_id, number_value)` are unique:
  even a released/reused number cannot occur twice in the same historical roster. The latter
  index also serves the requested composite lookup. Snapshots are required JSON objects;
  unavailable buyer/collector information may use `{}`. Ineligibility needs a trimmed non-blank
  reason of at most 1000 code points iff not eligible.
- Entry admission/edits lock the roster FOR SHARE to serialize against freeze. Future write RPCs
  must lock draw, then roster, then entries; they must not acquire a draw lock after roster locks.
  These tables never take a financial ledger lock. Real two-session dblink tests cover freeze
  first and admission first. Delete and truncate are forbidden for all three tables.
- Campaign count reductions cannot invalidate existing draws. Draw creation/installment edits
  take a campaign SHARE lock, and the reverse campaign guard checks draws. Future rule-edit RPCs
  must acquire campaign before draw (then roster/entries); status-only draw writes do not acquire
  campaign locks. Two further dblink races cover both admission/count-reduction orderings.
- Read RLS accepts any seeded draw permission, including load_winner. The original seed has all
  six permissions: admin has all, operator has load_winner, treasurer freeze_roster/load_winner;
  later SAN-93 grants their implied draw.view. Thus admin/operator/treasurer read all three
  tables, collector and read_only read none. There is deliberately no collector-own snapshot
  exception: permissions.md reserves portfolio access for a later feature, and snapshots expose
  other buyers. The RLS helper has an explicit authenticated EXECUTE grant (SAN-102); internal
  triggers have none.
- State/roster synchronization, nonempty roster generation, campaign operational status, audit
  request context, and permission-checked write APIs belong to subsequent draw RPC tickets.
  The storage guard does not assume those future RPCs exist or introduce a fake write API.
- Existing pgTAP 008's explicit truncate dependency list now includes roster entries, because
  their new bond FK must not mask the original owner-level prohibition with a missing-table error.

Validation: local reset and `supabase test db` passed **37 files / 2323 assertions**, including
**190 assertions** in 037 and four real two-session races (no concurrency skips).
`pnpm check`: **0 errors / 0 warnings**; `pnpm lint`: passed; `pnpm test`:
**117 files / 1482 tests**; after local admin/fixture seeding, `pnpm test:integration`:
**22 files / 186 tests**. The first integration attempt lacked seeded users and failed sign-in;
seeding and rerunning passed. Run pgTAP after reset, before integration: pre-existing suites
027/028/030/032 use global financial/audit counts and fail on integration leftovers; those unrelated
assertions are not changed here. All 037 counts/denial audits are scoped to its own fixtures.
Race cleanup uses transaction-local `session_replication_role = replica` in the owner-only test
connection and exact fixture ids, avoiding ALTER TABLE locks against the local test transaction.

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

### SAN-80: implemented prize storage (Phase 12)

Migration `20261225000000_prizes.sql` implements the three preceding tables; pgTAP
`041_prizes.test.sql` verifies storage, authorization, immutable history and real two-session
admission races. This is **storage only**: no client write path or new RPC is exposed.
SAN-81 must supply audited `SECURITY DEFINER` functions with an empty search path, check
`draw.load_winner`, `prize.resolve` or `prize.deliver` as appropriate, and audit in the same
transaction. This migration does not change the SAN-77 consolation generation gate.

#### Columns and limits

- All three tables have UUID `id`, `created_at`, required `created_by` (profile FK) and
  `updated_at`; updates refresh `updated_at`. All FKs restrict deletion and have a full,
  leading-column index (including indexes supplied by UNIQUE constraints).
- `prizes`: required `draw_id`, `name` (1..200 code points), optional `description` (1..1000),
  positive integer `position` unique per draw, and `status` defaulting to `pending_validation`.
  `excludes_from_consolation` is a required boolean defaulting to **true**.
- `winning_numbers`: required `draw_id`, `prize_id`, integer `number_value` (0 through the
  campaign's `max_number`, inclusive), nullable `matched_roster_entry_id`, required
  `result_status`, `loaded_by` and `loaded_at` (default now), optional `notes` (1..1000).
  There is intentionally no default result: the future loading RPC must decide explicitly.
- `prize_awards`: required `prize_id`, `winning_number_id`, `bond_id`, `buyer_id`, `collector_id`,
  `status` defaulting to `awarded`, `awarded_at` defaulting to now, optional `notes` (1..1000).
  Delivery adds `delivered_at` and `delivered_by`; both are required **iff** `delivered`.
  Delivered awards also require observations in `notes`, satisfying the documented date,
  user and observations requirement.
- Both prizes and awards have separate `annulled_at`, `annulled_by`, `annul_reason` fields.
  All three are required iff annulled; reasons are 1..1000 code points. All text is trimmed
  and nonblank when present; optional text uses SQL NULL, never an empty string.
  Limits use PostgreSQL `char_length`, matching the TS code-point contract, not UTF-16 length.

#### Lifecycle and historical decisions

- Prizes start only in `pending_validation`. Exact transitions:
  `pending_validation -> awarded | unawarded`, `awarded -> pending_delivery | annulled`,
  `pending_delivery -> delivered`. Delivered, unawarded and annulled prizes are immutable,
  including same-status updates. Identity/ancestry/creation metadata never change.
  Name, description, position and consolation exclusion can change only before resolution.
- **Uniqueness decision:** one loaded winning number per prize, with no uniqueness on
  `(draw_id, number_value)`. The docs do not prohibit one participating number winning
  different positions. No correction by overwriting/reloading a resolved result is available:
  future correction requirements need an explicit audited history model, not destructive edits.
- A winner can be inserted, or a pending review updated, only for a `roster_frozen` or
  `completed` draw with an actual frozen roster. A closed draw rejects winner writes.
  Matching is determined by the exact number in that draw's frozen roster, not a caller's
  guess: `no_match` iff the entry is NULL, and an existing match cannot be hidden as no-match.
  `eligible_winner` requires `eligible = true`; `not_eligible` requires `eligible = false`.
  The prize and winning number must refer to the same draw (and therefore campaign).
- **Review decision:** pending review is allowed only with a matched frozen entry, either
  eligible or ineligible. It may resolve only to the corresponding eligibility result; it
  cannot override frozen eligibility. Loaded number, matched entry, parents, loader/time and
  creation metadata are immutable even during review. Resolved results (including no-match)
  are fully immutable. The docs list result states but no separate winning-number state graph;
  this deliberately conservative graph preserves the snapshot.
- Awards start only in `awarded`; `awarded -> delivered | annulled` are the only transitions.
  Delivered and annulled awards are immutable. Award source identities, award timestamp and
  creation metadata never change. Only one non-annulled award per prize is permitted by a
  partial unique index; annulled history remains when a replacement award is recorded.
- An award must refer to that prize's **eligible resolved winner**. Bond is the physical
  `draw_roster_entries.bond_id`, including manual-pata member ownership; buyer and collector
  use the real frozen snapshot keys `buyer_snapshot.id` / `collector_snapshot.id`.
  Current buyer/collector values are deliberately not substituted: later sales/custody changes
  must not rewrite history. Missing snapshot identities cannot receive an award.
- Prize workflow status and award workflow status are separate storage machines. SAN-81 must
  resolve/annul/deliver them atomically, including creating an award and advancing its prize.
  Cross-table existence checks tying every intermediate prize status to an award are not
  imposed here, since either insertion order would otherwise require deferred write machinery.
  There is no unaudited API path that can leave such an intermediate state committed.
- No API role (`anon`, `authenticated`, `service_role`) has INSERT/UPDATE/DELETE/TRUNCATE,
  and no write RLS policies exist. Even owner DELETE/TRUNCATE is rejected (`23001`).
  Invalid checks/transitions raise `23514`, immutable identity changes `23001`, wrong lifecycle
  `55000`, missing FK references `23503`, and duplicate positions/results/active awards `23505`.
  SAN-81 must map its RPC errors explicitly and use 42501 for permission denial.

#### Consolation contract

The flag belongs to the **prize**, not the entire draw: administrators can configure a
non-excluding position without implicitly changing every other prize in that draw.
Default true is conservative; awarded prizes freeze this choice.
An authoritative previous win is a `prize_awards` row with status `awarded` or `delivered`,
joined to a non-annulled prize with `excludes_from_consolation = true`; annulled awards/prizes
do not exclude. Consumers join `prizes -> draws` to restrict campaign and previous draws,
and identify the winning bond through the frozen roster entry/award. For manual patas,
SAN-77's existing effective-parent mapping must propagate a physical member win to the
commercial parent and its participating members, rather than assuming award bond is the parent.
No derived flag is written on bonds, no winner is inferred from prize status alone, and merely
loading an eligible winning number does not exclude until an actual award exists.
Which draws count as “previous” at equal dates remains a future generation/RPC policy;
consumers must use a documented deterministic draw ordering, never unspecified row order.

#### Locks, authorization and remaining scope

Winner admission reads the campaign id without locking, then locks **campaign FOR SHARE ->
draw FOR SHARE**, stabilizing both `max_number` and the draw lifecycle. Frozen rosters/entries
are already immutable. A new campaign guard also rejects lowering `max_number` below any
historical winning value (including no-match), so the invariant holds in both directions.
That read-only trigger helper is SECURITY DEFINER with an empty search path: legacy campaign
writers must be checked against protected winner rows without acquiring SELECT privileges on
them. It has no API EXECUTE grant and makes no writes of its own.
Future write RPCs must prelock **campaign -> draw -> prize -> winner -> award**, with ids sorted
at each level when touching multiple rows. On UPDATE, row triggers run after the target row
lock; privileged writers must prelock parents, never invert that order. There are no new
financial writes, settlement/payment/installment locks or ledger advisory locks.
The real dblink tests cover committed maximum reduction versus admission in both orders,
and draw closure versus admission in both orders.

Only authenticated gets SELECT. Select-only RLS permits `draw.view` OR `draw.load_winner` OR
`prize.resolve` OR `prize.deliver`; its SECURITY DEFINER read helper has an empty search path
and an explicit authenticated EXECUTE grant. Internal trigger functions have no API EXECUTE.
In the actual seed, admin has every permission; operator and treasurer have `draw.load_winner`,
while only admin has prize resolution/delivery. Read-only, collector and roleless users see
no prize rows. These are capability checks, not hard-coded role checks.

TS `src/lib/domain/prizes.ts` mirrors the statuses, English labels, transition graphs and text/
numeric lower limits; the upper number bound is campaign-specific, not a global constant.
There are no routes or services in SAN-80. SAN-81 owns permission checks, audited writes,
coordinated prize/award transitions, correction policy and subsequent consolation enablement.

Validation after a clean local reset: `supabase test db` passed **40 files / 2780 assertions**
(041 plan: **299**); after local admin/role-fixture seeding, `pnpm test:integration` passed
**25 files / 202 tests**; `pnpm check` reported **0 errors / 0 warnings**; `pnpm lint` passed;
`pnpm test` passed **134 files / 1629 tests** (the four new domain tests included).
The initial full DB run caught two older owner-TRUNCATE tests whose explicit table lists no
longer covered the new FK dependents; 008 and 037 now include those dependents, preserving the
same `23001` trigger assertion rather than weakening it to an FK error.
It also caught the campaign guard's need for definer read access, fixed as described above.
Integration setup initially refused an unset local environment, then lacked seeded users;
the successful run explicitly used `APP_ENV=local`, the running local CLI credentials and
`pnpm seed:admin`, without weakening the integration safety guard.

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

Bond loads by barcode scan or file (CSV / Excel). Implemented in `20261124000000_import_sessions.sql` (SAN-44); decisions in `docs/imports.md`, states in `docs/state-machines.md`.

Fields:

- `id`, `campaign_id` (FK `campaigns`, `on delete restrict`; unique `(id, campaign_id)` is the target of `bonds.import_session_id`)
- `source_type`: `barcode_scan`, `csv_file`, `excel_file` (`legacy_system_export` is post-MVP)
- `status`: `draft` (default), `validated`, `confirmed`, `cancelled`, `failed`
- `file_name`: original file name; required for `csv_file` / `excel_file`, null for `barcode_scan` (not blank, trimmed, at most 255 characters)
- `notes` (optional, not blank, at most 2000 characters)
- `created_by` (profile, required), `created_at`, `updated_at` (set by the database)
- `validated_at`; `confirmed_at`, `confirmed_by`; `cancelled_at`, `cancelled_by`, `cancel_reason` (optional); `failed_at`, `failed_by` (optional, null for system actions), `failure_reason` (required when failed); `rolled_back_at`, `rolled_back_by`, `rollback_reason` (functional rollback of a confirmed import). The `*_at` columns are set by the database on the transition; callers set the `*_by` and reason columns. CHECKs keep them consistent with `status`.

Rules (constraints and the `import_sessions_guard_write` trigger, for every role):

- Created only in `draft`, only while the campaign is `draft` or `active` (`55000`).
- `id`, `campaign_id`, `source_type`, `file_name`, `created_by`, `created_at` never change (`23001`).
- Transitions (`23514` otherwise): `draft -> validated`, `validated -> draft`, `validated -> confirmed`, `draft|validated -> cancelled`, `draft|validated -> failed`.
- `-> validated` needs at least one live (not removed) item and none `pending` or `error`; `-> validated` and `-> confirmed` need the campaign `draft` or `active` (`55000`).
- `-> confirmed` needs every live item linked to the bond it created (`created_bond_id`) and that bond must be the right one: a `simple` item maps one-to-one to a simple bond whose `barcode` is the item barcode; all rows of a `grupo_pata` map to one printed pata with one row per unit and the `grupo_pata` as its barcode; no bond of the session can be left without a live item. Every bond must still be `available` and have its complete set of base and associated numbers (one per unit), with each row's `base_number` (and its `barcode` for a pata row) present on the base number (`55000` otherwise). A validated session that already has bonds (inside the confirming transaction) cannot go back to draft, be cancelled or fail (`55000`).
- `confirmed`, `cancelled` and `failed` are final (`55000`). A confirmed session only accepts the rollback marker, once, when none of its bonds is still live (all annulled).
- Never deleted: no API role has `DELETE`/`TRUNCATE`, and a trigger blocks the owner (`23001`).

### import_session_items

Staged rows (file) or scans of an import session (SAN-44).

Fields:

- `id`, `import_session_id` (FK, `on delete restrict`: sessions are never deleted, so no cascade)
- `row_number` (integer >= 1, unique per session): file row or scan order
- `raw_value` (required, at most 2000 characters), `parsed_value` (jsonb object, optional)
- `barcode`, `item_type` (`simple`, `pata`), `group_key` (the `grupo_pata`; required for `pata`, null for `simple`), `base_number` (>= 0)
- `status`: `pending` (default), `valid`, `warning`, `error`; `error_code` (`snake_case`) and `error_message`: required message for `error` / `warning`, none for `pending` / `valid`; `valid` / `warning` need `item_type` and `base_number`
- `created_bond_id`: the bond created on confirmation (a pata: the same bond for all its rows). Composite FK `(created_bond_id, import_session_id)` to `bonds (id, import_session_id)`: always a bond of the same session. Set once (`23001` afterwards), only while the session is `validated`, only on a `valid`/`warning`, not removed item
- `removed_at` (set by the database), `removed_by`, `remove_reason` (optional): soft removal of an erroneous row
- `created_at`, `updated_at` (set by the database)

Rules (constraints and the `import_session_items_guard_write` trigger):

- Items are added and changed only while the session is `draft` or `validated` (`55000`); the trigger locks the session row, so item writes serialize with its transitions. Adding or editing an item of a `validated` session moves the session back to `draft` (linking `created_bond_id` does not).
- `id`, `import_session_id`, `row_number`, `created_at` never change (`23001`). Removed items and items linked to a bond are immutable (`55000`).
- Never deleted (soft removal instead); a trigger blocks `DELETE`/`TRUNCATE`.

Access (both tables): `authenticated` can only `SELECT`, with `bond.import` **or** `bond.scan` (RLS). Writes go through audited SQL functions (SAN-45 staging and validation, SAN-47 confirmation and rollback). `service_role` has `SELECT`, `INSERT` and `UPDATE`; `anon` nothing.

SAN-45 write functions:

- `import_session_create(campaign_id, source_type, file_name, notes, request_id)`: creates a
  draft session. File sources require `bond.import`; `barcode_scan` requires `bond.scan`.
- `import_session_add_items(session_id, rows jsonb, request_id)`: stages up to 1,000 parsed file
  rows, revalidates them, and returns the preview summary. Payload shape errors are `22023`;
  business errors remain on their rows.
- `import_session_add_scan(session_id, barcode, group_key, base_number, raw_value, request_id)`:
  resolves the code using the campaign's barcode mode and stages one row. A scan with `group_key`
  is a pata row; otherwise it is simple.
- `import_session_remove_item(item_id, reason, request_id)`: audited soft removal, then
  revalidation.
- `import_session_validate(session_id, request_id)`: revalidates and moves `draft -> validated`
  only when every live row is valid and every pata group has at least two rows.
- `import_session_cancel(session_id, reason, request_id)`: audited cancellation of a draft or
  validated session.
- `import_session_summary(session_id)`: preview counts: simple bonds, patas, base and
  participating numbers, errors, warnings and duplicates.

File rows reach `import_session_add_items` already interpreted by the app
(`src/lib/domain/imports.ts`, `interpretImportRow`): `parsed_value` holds the four raw file fields
(`tipo_bono`, `grupo_pata`, `numero_base`, `barcode`; trimmed, blank = null), and `item_type`,
`group_key`, `base_number` and `barcode` are derived from them with the campaign's barcode rules.
A row the parser cannot interpret is staged with a `parse_*` `error_code` (kept by revalidation)
and no base number. Scans store `barcode`, `base_number`, `group_key` and `barcode_mode` in
`parsed_value`. See `docs/imports.md` ("App layer (SAN-45)").

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
- `import_session_items(import_session_id, status)`; also `(import_session_id, group_key)`, `(import_session_id, barcode)` and `(created_bond_id, import_session_id)`.
- `bond_numbers(campaign_id, barcode)` unique where `barcode IS NOT NULL AND released_at IS NULL`.
- `bonds(import_session_id)` where not null.
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

## Maximum text lengths (SAN-97)

Free-text columns written by the audited functions have a `char_length(col) <= N` CHECK with the
same N as the Zod schema that validates the field, so a caller that skips the app cannot save
longer text. Migration `20261213000000_text_length_checks.sql` lists every column with its source
constant; pgTAP `026_text_length_checks` covers each limit (over-length fails with 23514, the
boundary value succeeds). New text columns written by an RPC must get a CHECK and a Zod `.max()`
with the same number.

- `audit_log.reason` (1000) is shared by every audited function, so it takes the largest per-function
  limit. The tighter ones (500 for rule changes and imports) stay in Zod and in the per-column CHECKs.
- `bonds.internal_code`, `bonds.barcode` and `bond_numbers.barcode` take 200: manual entry is limited
  to 100 by Zod, but an import carries codes of up to 200 characters.
