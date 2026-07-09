# Project Documentation

## Objective

This folder contains the functional, technical, and operational design for the Firefighters bond/raffle management system.

## Recommended Reading

1. `mvp.md`
2. `functional-design.md`
3. `technical-design.md`
4. `data-model.md`
5. `state-machines.md`
6. `implementation-plan.md`

## Functional Documents

- `mvp.md`: scope of the first version.
- `functional-design.md`: modules, roles, screens, and flows.
- `screens.md`: priority screens and functional experience.
- `draw-rules.md`: rules for draws, draw rosters, and winners.
- `documents.md`: printable HTML delivery notes and certificates.
- `corrections.md`: audited cancellations and corrections.

## Technical Documents

- `technical-design.md`: SvelteKit + Supabase architecture.
- `data-model.md`: entities, relationships, and constraints.
- `state-machines.md`: states and transitions.
- `permissions.md`: roles, permissions, and initial matrix.
- `imports.md`: loading by barcode, files, and legacy system.
- `commissions.md`: rules, exceptions, and manual adjustments.

## Operation and Implementation

- `migration.md`: migration from the legacy system.
- `backup-operations.md`: backups, recovery, and production operation.
- `implementation-plan.md`: build phases.
- `open-questions.md`: closed decisions and pending questions.

## Key Criteria

- The MVP is a web/PWA with SvelteKit, TypeScript, and Supabase.
- Numbers are configurable per campaign, not globally.
- Collector balances are calculated from movements.
- Closed collector settlements are not reopened.
- Draws use frozen draw rosters.
- Corrections are made through audited cancellations or adjustments.
- Initial documents are printable HTML.
