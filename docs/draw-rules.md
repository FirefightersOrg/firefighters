# Draw rules

## Objective

Define functional eligibility rules for MVP draws.

## Draw types

- Monthly.
- Extraordinary for full payment.
- Final.
- Consolation.

## Monthly draw

Rule:

```txt
To participate, the required installment for the draw and all previous ones must be paid before the cutoff date.
```

Example:

```txt
December draw
Required installment: 3
Installments 1, 2, and 3 must be paid before the cutoff.
```

## Extraordinary draw for full payment

Rule:

```txt
Those who have paid the full bond before the cutoff date participate.
```

Extra numbers:

```txt
Simple bond = 1 extra number
Pata = N extra numbers based on the quantity of base numbers
```

Example:

```txt
Pata with 5 base numbers
Normal participation: 5 base + 5 associated = 10 numbers
Additional extraordinary participation: 5 extra numbers
```

Extra numbers must be persisted or frozen in the extraordinary draw roster to justify historical results.

## Final draw

Defined rule:

```txt
To win the final draw, the bond must be fully paid.
```

Validation must be done against confirmed payments before the cutoff defined for the final draw.

## Consolation draws

Defined rule:

```txt
Only non-winning bonds that are up to date participate.
```

Conditions:

- Not having won in previous draws that exclude from consolation.
- Being up to date per required installment or configured consolation rule.
- Appearing as enabled in the frozen roster.

## Frozen roster

All draws must have a frozen roster before loading winners.

The roster must include:

- Enabled.
- Not enabled.
- Reason for non-enablement.
- Participating number.
- Bond.
- Buyer.
- Collector.
- Generation date/time.
- Freeze date/time.

## Winner loading

```txt
Enter winning number
↓
Search in frozen roster
↓
Determine associated bond
↓
Verify enablement
↓
Register result
```

Possible results:

- Enabled winner.
- Prize not awarded due to lack of payment.
- Prize not awarded for not meeting draw rule.
- No matching number.
- Pending review.

## Implemented in SAN-76

- `src/lib/domain/draw-eligibility.ts` evaluates the four draw types from plain snapshots. It
  only counts `confirmed` payments and sums applications in integer cents.
- Payments have a Buenos Aires calendar `payment_date` but no confirmation timestamp. Eligibility
  therefore compares that date (not `created_at`) with the Buenos Aires calendar day containing
  `payment_cutoff_at`; the cutoff day is inclusive.
- Monthly eligibility covers every installment from 1 through the required number. Extraordinary
  and final eligibility require every plan installment to be fully covered; this treats a
  `full_payment` plan's single installment and a fully covered installment plan consistently.
- Consolation uses its configured required installment when present, otherwise the draw's required
  installment, and excludes any previous win marked as excluding from consolation.
- Ineligibility is returned as a stable code; English and Spanish label maps are separate from the
  frozen value.
- Extraordinary numbers are deterministic: eligible bonds are ordered by lowest base number and
  then bond id, each pata's bases by value and id, and the lowest free campaign values are assigned
  first. Simple bonds receive one; patas receive one per base. Capacity is checked first, so
  exhaustion raises a typed error and returns no partial assignment.
- SAN-76 does not persist these assignments or generate/freeze rosters; SAN-77 owns both operations.

## SAN-78 UI decisions

- A `datetime-local` cutoff is treated as a Buenos Aires wall-clock value and persisted with the
  `-03:00` offset. Date-only draw dates remain date-only and are never passed through `Date`.
- The optional consolation installment is stored in
  `eligibility_rule.consolation_rule.required_installment_number`, matching the snake-case snapshot
  accepted by SAN-76. Other draw types currently use an empty eligibility object because their MVP
  rules are fixed in this document.
- Roster reads fetch every RLS-visible row in deterministic 500-row PostgREST pages, then apply the
  combined formatted-number/bond/buyer/collector search and eligibility filter before presenting
  50-row UI pages. This deliberately favors correct results past PostgREST's 1,000-row default.
- All draw capabilities grant navigation/read access, matching `draw_can_read`; action buttons still
  require their specific permission. The roster marks persisted `bond_numbers.number_kind =
'extraordinary'` explicitly so historical extra participation is distinguishable.

## Implemented in SAN-77

### Trusted writes and configuration

- The new `20261224000000_draw_roster_services.sql` migration leaves SAN-75 unchanged.
  `draw_generate_roster(draw_id, request_id)` returns the new roster UUID; it computes eligibility
  inside the database and never accepts client-supplied entries or eligibility flags.
  `draw_freeze_roster(draw_id, request_id)` returns void (the SAN-78 UI contract).
- The scope also includes `draw_create` (UUID result), `draw_update` and `draw_annul` (void).
  Create requires `draw.create` and a draft/active campaign. Update requires `draw.update`,
  preserves draw type and only edits scheduled draws; changing the installment takes the campaign
  lock before the draw lock and remains bounded by the campaign's installment count.
- There is no `draw.annul` permission in `docs/permissions.md`, so annulment uses `draw.update`.
  Only `scheduled -> annulled` is allowed, exactly as in `docs/state-machines.md` and SAN-75.
  Generated/frozen draws cannot be annulled; no frozen history is changed or discarded.
  Annulment has its own timestamp, actor and trimmed 1..1000-code-point reason.
- Names are trimmed, nonblank and at most 200 Unicode code points. Configuration dates remain
  date-only; the payment cutoff is a timestamp. Monthly configuration requires a positive
  installment number. Eligibility configuration is a JSON object, as in SAN-75; final and
  extraordinary draws always require the complete active plan regardless of installment setting.
  Consolation configuration can be saved even though generation is currently unavailable.
- Every RPC uses `SECURITY DEFINER`, an empty search path, an active-profile permission check,
  and exactly one audit row on success in the same transaction. Only authenticated callers get
  EXECUTE; helpers are internal. Existing direct-write revocations and read RLS remain intact.
  `draws.ts` and `draw-rosters.ts` require `{ requestId, permissions }`, fail closed before any
  database call and explicitly map 42501/55000/22023/23514/P0002 to 403/409/400/400/404.

### Participation, snapshots and lifecycle

- Include all **currently reserved** base/associated numbers of the campaign, sold or unsold,
  with an eligibility flag and stable SAN-76 reason code. This implements the requirement to show
  both enabled and non-enabled numbers. Extraordinary reservations appear only in extraordinary
  rosters. Released number rows are historical, not participants (including an annulled mistaken
  load); they are excluded to avoid duplicate participating values after ordinary number reuse.
  An annulled sale whose numbers remain reserved still appears as ineligible with `annulled`.
- Active manual patas retain number ownership on their member bonds (the SAN-75 entry FK/guard
  requires that physical owner). Their parent pata supplies the commercial status, active sale,
  payment plan, buyer and collector; numbers and extra source-base links retain their physical
  member ownership. Printed patas supply one extra per base; simple members of a manual pata
  collectively supply one per parent base, without double counting the numberless parent.
- Eligibility, commercial state, buyer and collector are materialized by one SQL statement.
  Buyer snapshots contain id, first/last/business names, document number and tax id; collector
  snapshots contain id, display name and linked profile id (collectors have no document column).
  Missing parties produce JSON objects with null identity fields, never JSON null.
- Coverage sums exact SQL numerics against every required active-plan installment, never the
  installment's cached status. Only confirmed payment applications count; adjusted, annulled,
  pending and draft payments do not. Monthly checks every installment 1..required; final and
  extraordinary require a nonempty, fully covered plan, including a full-payment plan's one
  installment. Reason precedence matches SAN-76: annulled, not sold, then payment coverage.
- **Cutoff decision remains isolated:** `draw_payment_before_cutoff(status, payment_date, cutoff)`
  is the sole predicate for qualifying payments. It compares `payment_date` with the Buenos Aires
  calendar day of the cutoff, inclusively, and checks status at generation time. A confirmed
  payment on that day counts even if its confirmation occurred later. The product question about
  confirmation-timestamp semantics remains open; payments currently have no such timestamp.
- Generation locks campaign FOR SHARE, draw FOR UPDATE, then existing rosters in UUID order.
  Regeneration is allowed only before freeze, supersedes previous generated rosters and preserves
  all their entries. Freeze locks draw then the current generated roster; it never takes a
  campaign lock after the draw lock. It sets freeze actor/time and `roster_frozen` atomically.
  A second freeze is a 55000 conflict, not an idempotent success, and adds no audit row.
- Frozen rosters are immutable snapshots: later confirmations, payments and audited payment
  corrections cannot update their entries. Tests compare **full entry rows**, including ids and
  timestamps, after a late confirmation and an actual `payment_annul` correction.

### Extraordinary reservations and concurrency

- Eligible bonds are ordered by lowest base value, then effective bond UUID, and sources by base
  value then base UUID. The allocator reserves the lowest free values in ascending order,
  matching SAN-76. Capacity is checked before inserting anything; failure rolls back the whole
  invocation, including roster status, reservations and audit.
- **Campaign-wide reuse decision:** one immutable extraordinary row per source base is reused
  on regeneration **and across later extraordinary draws in the same campaign**. No draw-specific
  ownership is invented on `bond_numbers`. A unique source-base index backs this invariant.
  Reused numbers remain visible as ineligible if that bond later fails payment eligibility.
- Extraordinary allocation never reuses any historically reserved value, including released
  values; existing ordinary bond creation can still reuse released ordinary numbers by its own
  documented rules. Released extraordinary rows are never reactivated or replaced.
- A campaign-specific transaction advisory lock (hash seed 77, distinct from financial seed 68)
  serializes extraordinary allocators after the roster locks. Number insertion also uses the
  existing bond-number guard's owner lock. These services do not acquire financial locks or
  lower any ledger balance. Ordinary concurrent bond creation does not take the new advisory
  lock: a uniqueness collision aborts generation with 55000 and asks the caller to retry,
  without partial writes.
- pgTAP uses two real dblink sessions calling the RPCs: freeze waits for generation, generation
  waits for and refuses a committed freeze, and two different extraordinary draws serialize
  allocation and reuse the same persisted extra without duplicates.

### Known gap and verification

- **Consolation generation deliberately fails closed with 55000:** “consolation rosters require
  draw results (Phase 12): not available yet”. Neither SAN-75 nor SAN-76 persists previous winners
  or exclusion flags. Adding a pretend winners table or silently assuming no prior wins would
  grant incorrect eligibility; winner storage belongs to Phase 12, not SAN-78 (UI).
  Enable generation only when authoritative previous-result storage exists, then apply SAN-76's
  `already_won` precedence and configured required-installment rule. The pure TS consolation
  evaluator remains unchanged and available for preview with explicit previous-win snapshots.
- `038_draw_roster_services.test.sql` covers exact monthly/final/extraordinary rows and reasons,
  the consolation refusal, identity snapshots, base-linked deterministic extras, regeneration,
  exhaustion rollback, freeze and history guards, late confirmation/correction independence,
  permission denials with unchanged state/no audit, audited configuration writes, direct-write
  privileges and real concurrency.
- The integration suite uses real admin/read-only users and signed-in admin financial reads.
  Draw configuration is created through the new service, not privileged fixture DML. It compares
  TS and SQL eligibility on the same persisted plans/payments for monthly/final/extraordinary
  draws, compares extraordinary assignments, generates/freezes through the services and proves
  that forged TS permissions cannot bypass database authorization.
- Validation: clean local reset followed by `supabase test db` **before** seeding/integration:
  38 database files / 2450 assertions passed (038 plan: 127); `pnpm test:integration`:
  23 files / 192 tests passed; `pnpm check`: 0 errors / 0 warnings; `pnpm lint`: passed;
  `pnpm test`: 121 files / 1575 tests passed.
