# Project Documentation

## Objective

This folder contains the functional, technical, and operational design of the Firefighters bond/raffle management system.

## Recommended reading

1. `mvp.md`
2. `functional-design.md`
3. `technical-design.md`
4. `data-model.md`
5. `state-machines.md`
6. `implementation-plan.md`

## Functional documents

- `mvp.md`: first version scope.
- `functional-design.md`: modules, roles, screens, and flows.
- `screens.md`: priority screens and functional experience.
- `draw-rules.md`: draw rules, rosters, and winners.
- `documents.md`: printable HTML delivery notes and certificates.
- `corrections.md`: annulled and audited corrections.

## Technical documents

- `technical-design.md`: SvelteKit + Supabase architecture.
- `data-model.md`: entities, relationships, and constraints.
- `state-machines.md`: states and transitions.
- `permissions.md`: roles, permissions, and initial matrix.
- `imports.md`: barcode loading, file imports, and legacy system.
- `commissions.md`: rules, exceptions, and manual adjustments.

## Operations and implementation

- `migration.md`: migration from legacy system.
- `backup-operations.md`: backups, recovery, and production operations.
- `implementation-plan.md`: build phases.
- `open-questions.md`: closed decisions and pending questions.

## Key criteria

- The MVP is a web/PWA built with SvelteKit, TypeScript, and Supabase.
- Numbers are configurable per campaign, not global.
- Collector balances are calculated from movements.
- Closed settlements cannot be reopened.
- Draws use frozen rosters.
- Corrections are made through annulments or audited adjustments.
- Initial documents are printable HTML.
