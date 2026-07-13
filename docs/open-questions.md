# Decisions and open questions

## Objective

This document separates decisions already made from questions that remain open. It serves as a criteria record to avoid blocking the functional and technical design of the system.

## Closed decisions

### MVP platform

The MVP will be an installable PWA webapp.

Defined stack:

```txt
SvelteKit + TypeScript + Supabase + PWA
```

Out of MVP scope:

- Tauri.
- Rust.
- Complex custom backend from day 1.

### Numbering per campaign

The number of digits will not be a global system rule. It will be configuration per campaign.

Initial configuration for the MVP:

```txt
number_digits = 4
max_number = 9999
associated_number_offset = 4871
overflow_policy = reject
```

Example of a future campaign with 5 digits:

```txt
number_digits = 5
max_number = 99999
associated_number_offset = 4871
overflow_policy = reject
```

Rule:

```txt
associated_number = base_number + associated_number_offset
```

For the MVP, if `associated_number > max_number`, loading is blocked.

### Leading zeros

Leading zeros must be preserved visually.

The system must differentiate:

```txt
internal value: 68
visible value: 0068
campaign digit count: 4
```

`padStart(4)` must not be hardcoded. Formatting must use the campaign configuration.

### Uniqueness of participating numbers

Within the same campaign, a participating number cannot point to more than one bond.

Participating number includes:

- Base number.
- Associated number.
- Base numbers included in patas.
- Associated numbers of patas.
- Extraordinary numbers if implemented as persisted numbers.

Default rule: block duplicates.

### Pata value

Provisional rule:

```txt
pata_value = simple_bond_value * base_number_count
```

This rule must be configurable per campaign to allow future administrative adjustment.

### Commissions

Commission is not consolidated when recording an isolated payment. It is calculated on a preliminary basis while the settlement is open and confirmed when closing the settlement.

When closing a settlement, the system generates definitive entries in the collector's current account.

### Closed settlements

A closed settlement is not reopened or edited directly.

Any subsequent error is corrected through annulment or audited adjustment.

### Draws in MVP

The MVP must include draws, with controlled scope:

- Monthly draws.
- Extraordinary draw for full payment.
- Final draw.
- Consolation draws.
- Frozen roster.
- Loading of winning numbers.
- Validation of eligible or ineligible winner.
- Recording of awarded, pending, or unawarded prizes.

Confirmed rules:

- Final draw: must be fully paid to win.
- Consolation draws: only non-winning bonds that are up to date participate.
- Extraordinary draw: adds N extra numbers based on the count of base numbers of the bond.

### Adaptable permissions

The system will use roles as groupers of granular permissions. Behavior must not be hardcoded solely by role name.

Reference document: `docs/permissions.md`.

### Adaptable screens

Screens are designed by operational flow and visible actions depend on permissions. This allows adding roles or changing permissions without rebuilding entire screens.

Reference document: `docs/screens.md`.

### Barcode loading

Each physical bond contains a barcode. The MVP must support loading and searching by scanning.

Since it is not confirmed what the old code represents, the interpretation must be configurable per campaign via `barcode_mode`.

Reference document: `docs/imports.md`.

### Printable documents

The MVP will use printable HTML for delivery notes and certificates. Persistent PDF is left as a future improvement.

Reference document: `docs/documents.md`.

### Special commissions and adjustments

The system must support special rules per collector and manual commission adjustments authorized by administration.

Every adjustment must require a reason and audit.

Reference document: `docs/commissions.md`.

### Migration from old system

It is considered that the old system may export collectors, buyers, and historical numbers from the previous campaign.

Migration must go through staging, validation, and confirmation before impacting definitive data.

Reference document: `docs/migration.md`.

### Backups and operations

The MVP must operate with automatic backups, exports before risky operations, and a restoration procedure.

Initial objectives:

```txt
RPO: maximum 24 hours
RTO: restoration within the same day
```

Reference document: `docs/backup-operations.md`.

## Open questions

### Definitive pata value

Pending confirmation of whether a pata always equals `simple_bond_value * base_number_count` or if there are commercial exceptions.

Temporary decision: implement a configurable rule with proportional default value.

### Special commissions

Pending confirmation of exact percentages:

- Cash payment.
- First installment.
- Middle installments.
- Last installment.

Temporary decision: model configurable rules per campaign, installment/payment type, and collector.

### Collector access

Pending confirmation of whether collectors will have their own user accounts in the MVP.

Temporary decision: operate from administration, but model a `cobrador` role to avoid blocking future access.
