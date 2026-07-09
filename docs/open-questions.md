# Decisions and Open Questions

## Objective

This document separates decisions already made from questions that remain open. It serves as a criteria record to avoid blocking the system's functional and technical design.

## Closed Decisions

### MVP Platform

The MVP will be an installable PWA-style webapp.

Defined stack:

```txt
SvelteKit + TypeScript + Supabase + PWA
```

Outside the MVP scope:

- Tauri.
- Rust.
- A complex custom backend from day 1.

### Numbering by Campaign

The number of digits will not be a global system rule. It will be configuration for each campaign.

Initial configuration for the MVP:

```txt
number_digits = 4
max_number = 9999
associated_number_offset = 4871
overflow_policy = reject
```

Example of a future 5-digit campaign:

```txt
number_digits = 5
max_number = 99999
associated_number_offset = 4871
overflow_policy = reject
```

Rule:

```txt
numero_asociado = numero_base + associated_number_offset
```

For the MVP, if `numero_asociado > max_number`, loading is blocked.

### Leading Zeros

Leading zeros must be visually preserved.

The system must differentiate:

```txt
internal value: 68
visible value: 0068
campaign digit count: 4
```

`padStart(4)` must not be hardcoded. Formatting must use the campaign configuration.

### Uniqueness of Participant Numbers

Within the same campaign, a participant number cannot point to more than one bond.

Participant number includes:

- Base number.
- Associated number.
- Base numbers included in patas (multi-number bond/package).
- Associated pata numbers.
- Extraordinary numbers if implemented as persisted numbers.

Default rule: block duplicates.

### Pata Value

Provisional rule:

```txt
valor_pata = valor_bono_simple * cantidad_numeros_base
```

This rule must remain configurable by campaign to allow future administrative adjustment.

### Commissions

The commission is not consolidated when an isolated payment is loaded. It is calculated preliminarily while the collector settlement is open and confirmed when the collector settlement is closed.

When a collector settlement is closed, the system generates definitive movements in the collector's current account.

### Closed Collector Settlements

A closed collector settlement is not reopened or edited directly.

Any later error is corrected through an audited cancellation or adjustment.

### Draws in MVP

The MVP must include draws, with controlled scope:

- Monthly draws.
- Extraordinary draw for full payment.
- Final draw.
- Consolation draws.
- Frozen draw roster.
- Loading winning numbers.
- Validation of eligible or ineligible winner.
- Recording of awarded, pending, or not-awarded prizes.

Confirmed rules:

- Final draw: full payment is required to win.
- Consolation draws: only non-winning bonds that are up to date participate.
- Extraordinary draw: adds N extra numbers according to the number of base numbers in the bond.

### Adaptable Permissions

The system will use roles as groupings of granular permissions. Behavior must not be hardcoded only by role name.

Reference document: `docs/permissions.md`.

### Adaptable Screens

Screens are designed by operational flow, and visible actions depend on permissions. This allows adding roles or changing permissions without rebuilding complete screens.

Reference document: `docs/screens.md`.

### Barcode Loading

Each physical bond contains a barcode. The MVP must support loading and searching by scanning.

Because what the old code represents is not confirmed, interpretation must be configurable by campaign through `barcode_mode`.

Reference document: `docs/imports.md`.

### Printable Documents

The MVP will use printable HTML for delivery notes and certificates. Persistent PDF remains a future improvement.

Reference document: `docs/documents.md`.

### Special Commissions and Adjustments

The system must support special rules by collector and manual commission adjustments authorized by administration.

Every adjustment must require a reason and audit.

Reference document: `docs/commissions.md`.

### Migration from Legacy System

It is assumed that the legacy system may export collectors, buyers, and historical numbers from the previous campaign.

The migration must go through staging, validation, and confirmation before impacting final data.

Reference document: `docs/migration.md`.

### Backups and Operation

The MVP must operate with automatic backups, exports before risky operations, and a restoration procedure.

Initial objectives:

```txt
RPO: maximum 24 hours
RTO: same-day restoration
```

Reference document: `docs/backup-operations.md`.

## Open Questions

### Final Pata Value

Pending confirmation whether the pata always equals `valor_bono_simple * cantidad_numeros_base` or whether commercial exceptions exist.

Temporary decision: implement a configurable rule with a proportional default value.

### Special Commissions

Pending confirmation of exact percentages:

- Cash payment.
- First installment.
- Intermediate installments.
- Last installment.

Temporary decision: model configurable rules by campaign, installment/payment type, and collector.

### Collector Access

Pending confirmation whether collectors will have their own user in the MVP.

Temporary decision: operate from administration, but model the `collector` role so future access is not blocked.
