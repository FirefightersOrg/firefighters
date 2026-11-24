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
  Create requires `draw.create` and a draft/active campaign. Update requires `draw.update`
  and a draft/active campaign (55000 otherwise),
  preserves draw type and only edits scheduled draws; changing the installment takes the campaign
  lock before the draw lock and remains bounded by the campaign's installment count.
- There is no `draw.annul` permission in `docs/permissions.md`, so annulment uses `draw.update`.
  Originally only `scheduled -> annulled` was allowed; SAN-117 adds the narrow
  generated-extraordinary exception below. Frozen draws still cannot be annulled.
  Annulment has its own timestamp, actor and trimmed 1..1000-code-point reason.
- Names are trimmed, nonblank and at most 200 Unicode code points. Configuration dates remain
  date-only; the payment cutoff is a timestamp. Monthly configuration requires a positive
  installment number. Eligibility configuration is a JSON object, as in SAN-75; final and
  extraordinary draws always require the complete active plan regardless of installment setting.
  Consolation configuration can be saved even though generation is currently unavailable,
  but create/update reject a missing or invalid required installment with 22023 and an explicit
  message. The positive integer can come from the column or the JSON rule; matching SAN-76,
  `requiredInstallmentNumber` takes precedence over `required_installment_number`, then the
  column. JSON null falls through; an invalid non-null rule does not silently fall back.
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
- Generation locks campaign FOR SHARE (except SAN-81 consolation, documented below),
  draw FOR UPDATE, then existing rosters in UUID order.
  Generation also requires the locked campaign to be draft/active (55000 for closing, closed
  or annulled), before any extraordinary reservation or roster write. The existing campaign
  lock stabilizes the status check; this review does not change lock acquisition order.
  Regeneration is allowed only before freeze, supersedes previous generated rosters and preserves
  all their entries. Freeze locks campaign first (see SAN-81), then draw and the
  current generated roster; it never takes a campaign lock after the draw lock.
  It sets freeze actor/time and `roster_frozen` atomically.
  A repeated freeze of an already frozen roster is an idempotent no-op success (Santiago's
  decision on #79): nothing changes and no audit row is written.
  **Freeze decision (review 4642358561):** freezing an already generated roster remains allowed
  after campaign closure. It seals the existing snapshot, does not recompute eligibility or
  reserve numbers, and satisfies the documented requirement to freeze before winner loading.
  No campaign lock/status gate is added to freeze; pgTAP proves closed-campaign freeze and audit.
- Frozen rosters are immutable snapshots: later confirmations, payments and audited payment
  corrections cannot update their entries. Tests compare **full entry rows**, including ids and
  timestamps, after a late confirmation and an actual `payment_annul` correction.

### Extraordinary reservations and concurrency

- Eligible bonds are ordered by lowest base value, then effective bond UUID, and sources by base
  value then base UUID. The allocator reserves the lowest free values in ascending order,
  matching SAN-76. Capacity is checked before inserting anything; failure rolls back the whole
  invocation, including roster status, reservations and audit.
- **Campaign-wide reuse decision:** one currently reserved extraordinary row per source base is reused
  on regeneration **and across later extraordinary draws in the same campaign**. No draw-specific
  ownership is invented on `bond_numbers`. A unique source-base index backs this invariant.
  Reused numbers remain visible as ineligible if that bond later fails payment eligibility.
- SAN-117 makes extraordinary allocation release-aware: released values and source bases can be
  assigned again through a new row. Released historical rows are never reactivated or overwritten.
- A campaign-specific transaction advisory lock (hash seed 77, distinct from financial seed 68)
  serializes extraordinary allocators after the roster locks. Number insertion also uses the
  existing bond-number guard's owner lock. These services do not acquire financial locks or
  lower any ledger balance. Ordinary concurrent bond creation does not take the new advisory
  lock: a uniqueness collision aborts generation with 55000 and asks the caller to retry,
  without partial writes.
  **Review 4642358564:** only the individual `bond_numbers` insertion has a
  `unique_violation` handler. A uniqueness error elsewhere keeps SQLSTATE 23505 and its original
  constraint message; pgTAP installs a fixture-only roster index and verifies that failure rolls
  back supersession, creates no roster and writes no audit.
- PostgreSQL UUID ordering is byte-order, matching SAN-76's merged `compareBinary` tie-breaker
  for canonical UUIDs (no locale collation). The existing extraordinary integration parity
  comparison still passes after merging the SAN-75/SAN-76 review fixes.
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
  The SQL evaluator includes the same `missing_required_installment` reason for legacy missing
  consolation configuration, using the shared SQL resolver also used by create/update validation.
  This reason branch remains unreachable through roster generation while the Phase 12 gate is
  in place; no claim of end-to-end consolation parity is made without authoritative winners.
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
  38 database files / 2475 assertions passed (038 plan: 152); `pnpm test:integration`:
  23 files / 192 tests passed; `pnpm check`: 0 errors / 0 warnings; `pnpm lint`: passed;
  `pnpm test`: 121 files / 1577 tests passed.

## Implemented in SAN-81

### RPC and authorization contract

- Migration `20261226000000_prize_services.sql` adds `prize_create` (UUID),
  `prize_update` (void), `draw_load_winning_number` (winning-number UUID),
  `prize_resolve`, `prize_deliver`, and `prize_annul` (all void). SAN-80 and
  merged migrations are unchanged. All six are audited SECURITY DEFINER RPCs
  with empty search paths, explicit authenticated EXECUTE, and no public,
  anon or service-role EXECUTE. Private helpers have no API EXECUTE.
- Configuration uses **`draw.update`**, since the catalog has no prize-create
  permission. Loading uses `draw.load_winner`, resolution uses `prize.resolve`,
  correction uses the new **`prize.annul`** (seeded for admin only), and delivery
  uses `prize.deliver`. Checks use active-profile
  capabilities, never role names. No write RLS policies
  are introduced; no API role has direct prize/winner/award DML.
- TS `src/lib/server/services/prizes.ts` requires `{ requestId, permissions }`;
  unavailable permissions fail closed with 500 and missing permission with
  403 before any DB call. Zod mirrors SQL's trimmed, nullable optional text
  and Unicode-code-point limits (name 200, description/notes/reason 1000),
  positive int32 positions and nonnegative int32 numbers. Campaign-specific
  number bounds are authoritative in SQL. `42501`, `55000`, `22023`, `23514`,
  `P0002`, and `23505` map to 403/409/400/400/404/409 respectively.
  Context request IDs correlate calls; they are not idempotency keys.

### Loading, resolution and delivery

- Create always starts pending validation; update requires pending validation.
  All operations reject closed or annulled draws. Configuration can be created
  before generation and after freeze, allowing a corrected result to have a
  replacement prize. Configuration creation and editing reject completed draws
  with 55000. Completed-but-not-closed draws permit resolution, delivery,
  and undelivered correction; **loading requires exactly `roster_frozen`**.
  Consequently, annulment after completion is void-only: a replacement cannot
  be loaded on a completed draw (55000), and this task introduces no reopen
  transition. The replacement-and-reload workflow runs before completion.
  No campaign-status gate is added to prize workflows: an already frozen
  snapshot remains actionable after campaign closure, as with SAN-77 freezing.
- Loading searches only the draw's immutable **frozen** roster, including
  extraordinary entries. Eligible matches produce `eligible_winner`, leaving
  the prize pending validation. Ineligible matches produce `not_eligible` and
  make the prize unawarded; their original reason remains accessible through
  `matched_roster_entry_id`. Missing numbers produce `no_match` and unawarded.
  There is no manual override of frozen eligibility or new `pending_review`
  write path. SAN-80's one-winning-number-per-prize rule is retained. Duplicate
  loading checks under the prize lock and returns readable 55000, not raw 23505.
- Resolution requires an eligible loaded result and pending prize. `award`
  transitions through `awarded`, inserts the award and reaches `pending_delivery`
  in one transaction; `unaward` reaches terminal unawarded without an award.
  A missing loaded result or missing frozen party identity fails with 55000.
  The physical entry bond and actual snapshot keys `buyer_snapshot.id` and
  `collector_snapshot.id` determine ownership, never current parties or their
  active status. Resolved prizes freeze `excludes_from_consolation`.
- Delivery requires pending delivery and an awarded award. Both statuses advance
  atomically; server time, authenticated actor and required nonblank observations
  are recorded. Resolution notes are retained on the award and audit; unaward
  notes are retained in the audit reason. Delivery notes replace award notes,
  while the original resolution audit retains the original observations.
  Repeated resolve/deliver/annul calls fail state checks without duplicate
  awards or audit rows.

### Correction and immutable history

- **Replacement model:** annul the incorrect prize, then create a new prize at
  the same position and load the correct number on that new UUID. The active
  position index replaces SAN-80's unconditional uniqueness; a full draw-FK
  index remains. Multiple annulled historical positions are allowed, but only
  one live prize per `(draw_id, position)` exists. Same-row reloading is never
  allowed, and no loaded number, entry match or original result classification
  is overwritten or deleted.
- A winning-number result is **void by its parent prize's `annulled` status**,
  not by rewriting SAN-80's immutable `result_status`. Consumers must include
  the parent status when interpreting historical results. This deliberately
  preserves the original eligibility classification and frozen match.
- The general SAN-80 lifecycle guards remain unchanged for ordinary writes.
  The domain and documented state machine include audited correction from
  **pending_validation, awarded, pending_delivery, or unawarded only**, including
  an incorrect unloaded, unmatched or ineligible result. A delivered prize
  returns 55000 (the legacy SQL message still contains `pending product decision`
  for compatibility; SAN-125 resolves that decision and the service now explains
  that delivery must be reversed first).
  Correction requires `prize.annul`, not `prize.resolve`.
  A transaction-local marker selects the correction guard, which permits
  changing **only** status, dedicated annulment metadata and updated time.
  Inserts and changes to original history are rejected on that path. Forging
  the marker supplies neither table DML nor internal-helper EXECUTE.
- Reason is required, trimmed and at most 1000 code points. Original award
  timestamps, party identities, notes and delivered actor/time remain intact.
  The storage consistency constraint can retain paired historical delivery
  metadata, but the RPC never annuls delivered prizes. Re-annulment is refused; original annul reasons
  cannot be overwritten.
- Exactly one audit row is inserted by each successful RPC, in its transaction.
  Normal events carry the prize, winner and award snapshots plus campaign ID;
  annulment carries all nine correction fields (type, affected entity, related
  draw, reason, actor, date, previous/new snapshots and an empty compensatory
  movement list). There are no financial side effects. The separate annulment
  and replacement-loading audit events preserve both sides of a correction.

### Consolation and concurrency

- `draw_generate_roster(uuid,text)` is replaced faithfully from SAN-77, removing
  the Phase-12 refusal and adding authoritative previous-award evaluation and
  the configured consolation installment coverage. Its isolated payment-cutoff
  helper, ordinary number participation, commercial/party snapshot, regeneration,
  freeze protection, extraordinary allocation and all other behavior remain.
  The prior fail-closed assertions in 038 and integration now verify generation;
  SQL/TS parity covers consolation as well as the earlier three types.
- **Previous** means ascending `(draw_date, created_at, id)` within the same
  campaign, strictly less than the target draw. Date is primary, creation time
  resolves same-date draws, and UUID is the deterministic exact-timestamp
  tie-breaker. Current and later draws cannot exclude.
- Generation **and freezing** refuse consolation with 55000 while any
  non-annulled previous draw has an excluding `pending_validation` prize, with
  or without a loaded number: `previous draws of the campaign have unresolved
prizes that exclude from consolation`. Resolved means awarded, pending delivery,
  delivered, or unawarded; annulled prizes do not block.
  The gate also precedes the existing freeze idempotent no-op; a repeated freeze
  does not bypass unresolved-prize checks and never mutates the frozen snapshot.
- Only an `awarded` or `delivered` award of a non-annulled prize of a
  non-annulled previous draw whose
  `excludes_from_consolation` is true excludes a bond. Merely loading an eligible
  number blocks admission until resolved; an unawarded decision, a non-excluding
  prize, or an annulled award/prize does not exclude. Active manual-pata membership maps physical award bonds to effective
  parents, propagating a member win to all participating members.
- Reason precedence matches SAN-76: annulled, not sold, already won, missing
  required installment, insufficient installment coverage. The configured
  consolation rule resolves through the existing SAN-77 helper, including
  camel-case/snake-case precedence and column fallback.
- Every prize operation discovers parents without locks, then takes campaign
  SHARE → draw UPDATE → prize UPDATE → winner UPDATE → awards UPDATE, sorted
  by UUID within each level. The draw lock serializes same-draw admission,
  edits, resolution, delivery, correction and closure; no financial or ledger
  locks are involved. pgTAP 042 includes two real dblink sessions calling the
  RPCs: simultaneous result loads serialize and the loser rechecks state;
  lifecycle waits for a prize write; a prize write waits for committed closure
  and then refuses without audit.
- Only consolation generation and freezing take campaign **UPDATE before draw
  UPDATE**; all other draw types retain campaign **SHARE before draw UPDATE**.
  Both RPCs discover campaign ID and draw type without locks first; no API RPC
  changes an existing draw's type. Prize operations take campaign SHARE first.
  This serializes consolation admission against
  prior-prize mutations without locking previous draws out of order. Real dblink
  races verify both gates wait and recheck a newly committed pending prize with
  no state or audit writes on refusal. Two-session NOWAIT assertions also verify
  ordinary generation and freezing permit a concurrent campaign SHARE lock,
  avoiding campaign-wide exclusion of sales, deliveries and payment/prize RPCs
  during ordinary draws; consolation alone retains that stronger serialization.
- A resolved prize cannot revert to pending through the state machine. However,
  creation of a new pending excluding prize on a previous draw between generation
  and freeze is possible and tested: freeze refuses until resolution or annulment.
  Once frozen, snapshots remain immutable; corrections never rewrite them.
  Regenerate before freeze to capture changed resolved winners or corrections.

### Known gaps and decisions

- **SAN-117:** implemented below; the prior extraordinary-number release gap is closed.
- **SAN-125 decision (supersedes SAN-81's pending question):** delivered prizes
  cannot be annulled; mistaken delivery uses a separate audited reversal.
- **SAN-77 (inherited product question):** payment cutoff remains the inclusive
  Buenos Aires `payment_date`, not confirmation time, because payments have no
  confirmation timestamp. This task neither invents that timestamp nor changes
  cutoff semantics.
- **SAN-81 scope:** no routes/UI, winner override, or automatic draw completion
  is included; the task is SQL and services. Correction replacement is explicit,
  not an automatic clone, and clients use the new prize ID. These are intentional
  boundaries, not unimplemented RPC requirements.

## Implemented in SAN-82

- `/campaigns/[id]/draws/[drawId]/winners` is the prize operations screen and is linked from
  draw detail. It keeps configuration, load, resolution, delivery and correction controls
  permission- and state-aware, while every action repeats the permission check and verifies
  form-supplied prize IDs belong to the route draw before calling a service.
- A successful winning-number submission reads the persisted result back immediately. The UI
  formats the number with campaign padding and displays the frozen roster's real buyer and
  collector snapshot keys, bond, eligibility, exact ineligibility label and whether resolution
  is pending or the prize is unawarded. No current-party data is substituted for the snapshot.
- Prize reads use the signed-in RLS client. Lists are fetched in deterministic 500-row
  PostgREST pages so records beyond the 1,000-row default are not omitted. Missing prize lookups
  preserve the repository `{ data: null, error: null }` contract.
- Bond and buyer records list awards for their respective persisted `bond_id` / `buyer_id`.
  Delivery timestamps are converted as instants to `America/Argentina/Buenos_Aires`; date-only
  draw fields remain unchanged.
- Correction follows SAN-81's replacement model: an annulled prize offers a prefilled create
  form at the same position. Delivered prizes show the SAN-81 explanation and no annul control.
  Textareas deliberately have no native `maxlength`; server and service validation count Unicode
  code points.
- Decision: prize history is visible only with a capability accepted by prize read RLS
  (`draw.view`, `draw.load_winner`, or a prize action). A bond/buyer reader without one sees an
  explicit permission message rather than causing an RLS query failure.
- At SAN-82 delivery, **SAN-117** extraordinary-number release remained out of scope (now
  implemented below), and **SAN-81** forbids annulment of delivered prizes (now decided by SAN-125).

## Implemented in SAN-123: completing a draw

- `draw_complete(p_draw_id, p_request_id)` / `completeDraw` moves a draw from `roster_frozen` to
  `completed` (the only path to that state). Permission: `draw.update`, like `draw_annul`, until
  SAN-118 splits the draw permissions.
- Preconditions: at least one resolved non-annulled prize (Santi, #93: a draw with no prizes, or
  only annulled ones, cannot complete), and no non-annulled prize of the draw in `pending_validation` (with or without a
  loaded number). `pending_delivery` counts as resolved: deliveries can be recorded after completion.
  Otherwise `55000` ("resolve every prize of the draw before completing it"), with no write.
- Locks: campaign SHARE → draw UPDATE (`prize_lock_draw`) → the draw's prizes FOR SHARE in id order,
  so concurrent prize writes serialize with the completion.
- One `draw.complete` audit row with the before/after draw. After completion, prize creation and
  winner loading are refused; void-only prize annulment still works (SAN-81).
- The draw detail page offers "Complete draw" only on frozen draws to users with `draw.update`.

## SAN-125 — audited delivery reversal

- New RPC `prize_reverse_delivery(p_prize_id uuid, p_reason text, p_request_id text default null)`
  returns void; service `reversePrizeDelivery` and winners action `reverseDelivery`
  use the dedicated `prize.reverse_delivery` permission, seeded only to admin.
  Authorization checks permission codes, never role names. The reason is trimmed,
  mandatory and limited to 1000 Unicode code points in SQL and Zod.
- Decision: use an append-only `prize_delivery_reversals` table rather than single
  reversal columns, so multiple deliver/reverse cycles preserve **every** original
  `delivered_at`, `delivered_by`, delivery notes and full award snapshot. The award
  returns to `awarded` with its original resolution notes (from the resolution audit)
  and the prize to `pending_delivery`. No winner, roster, party or award identity changes.
- The RPC atomically archives the delivery, changes both statuses and records
  `prize.reverse_delivery` with before/after snapshots, actor, reason and request id.
  No financial movement is needed. Non-delivered or repeated reversals fail with
  55000 without writes; authorization fails with 42501 before state/validation.
- Locking is unchanged: `prize_lock` acquires campaign → draw → prize → winning
  numbers → awards. Racing reversals serialize; the loser rechecks state without
  a history or audit write.
- No certificate RPC/route contract change is needed: the current award's delivery
  fields are cleared, and the existing route requires **both** prize and award to
  be delivered. Reversed prizes cannot issue a delivery certificate; redelivery
  issues one for the new current delivery. Previously printed paper cannot be recalled.
- The winners form appears only for delivered prizes with the new permission,
  preserves failed input, and uses a required reason textarea without native maxlength.
- Known inherited gaps: **SAN-117** extraordinary-number release on draw annulment;
  **SAN-77** payment cutoff is inclusive Buenos Aires payment date, not a missing
  confirmation timestamp. The former **SAN-81** delivered-annulment product gap
  is resolved by **SAN-125**, not silently waived.

## Implemented in SAN-117

- **Approved product exception:** an extraordinary full-payment draw may transition from
  `roster_generated` to `annulled`, but never from frozen/completed/closed. Other draw types
  remain scheduled-only for annulment. The transition guard, domain predicate and detail-page
  annul capability agree; editing generated rules remains forbidden. Permission stays
  `draw.update`; RPC signatures and authenticated grants are unchanged.
- Extras are campaign-wide reservations, not draw-owned rows. Annulment considers every
  extraordinary number referenced by any roster of the annulled draw (including superseded
  rosters), and releases it only if **no roster of another non-annulled draw** references it.
  Ineligible entries also count as references. No roster or entry is deleted or rewritten.
- Release sets `released_at` and `released_by`; the number guard permits this narrow
  extraordinary exception without changing ordinary mistaken-load release rules. The
  source-base unique index applies to currently reserved extras only. Allocation checks
  currently reserved values/source bases, allowing a later draw to reuse the value and source
  in a **new UUID row**, while old snapshots retain the original number UUID/value.
- The single `draw.annul` audit event contains before/after draw snapshots, trimmed reason and
  sorted `new_value.released_number_ids` (an empty array when nothing is released). It is in the
  same transaction as status and release; audit failure rolls back both changes.
  Existing grants are retained, including SAN-23's trusted service-role bond-number access;
  draw/roster direct DML remains revoked from all API roles.
- Lock order: campaign SHARE → target draw UPDATE → its rosters in UUID order → campaign seed-77
  advisory lock, matching extraordinary generation. No previous/other draw is locked and no
  financial lock is acquired. Concurrent generation waits for annulment and can allocate a fresh
  reservation after its committed release; conversely, annulment waits for generation and keeps
  the newly referenced reservation.
- Known inherited gaps: **SAN-81** delivered-prize annulment awaits a product decision;
  **SAN-77** payment cutoff remains inclusive Buenos Aires payment date rather than confirmation
  timestamp. SAN-117 does not change either. No new functional gap is known.
