# UX redesign

Working documents of the frontend and UX/UI redesign (coordinated in #50).

| File                           | What it is                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| [`audit.md`](audit.md)         | What is wrong today, ordered by impact, with evidence, cause and a proposal for each item |
| [`direction.md`](direction.md) | The vision: principles, navigation, patterns per kind of screen, prototypes, proposals    |
| [`plan.md`](plan.md)           | The list of small PRs, in order, with scope, acceptance criteria and risk for each        |
| [`results.md`](results.md)     | Before and after for every measured flow and screen, and what became of each audit item   |

## Demo data and evidence

The walkthrough and flow scripts were used to measure the redesign and removed in PR 20 along with their screenshots and prototypes. The measurements are preserved in [results.md](results.md). The demo seed and screen list remain for the realistic-data E2E sweep.

### `pnpm seed:demo` (`scripts/seed-demo.ts`)

Loads the campaign «Bono Contribución 2026» through the same audited SQL functions the app calls, signed in as the seeded admin: 6 collectors (the first one linked to the fixture collector user, so the portal has data), 90 buyers, 240 bonds, 12 delivery notes, 147 sales (a quarter paid in full, the rest in 6 installments, sold over the last four months), 12 closed settlements and 3 open ones, two payments sent from the portal (one still unprocessed), a ledger adjustment, 3 returned bonds, a lost bond and three draws (frozen roster with a delivered and an unawarded prize, roster generated, scheduled). It also creates a second campaign in draft. Numbers come from a seeded generator, so a clean database always gets the same campaign. It does nothing if the campaign already exists.

### `scripts/demo-screens.ts`

The list of screens, addressed with records of the demo campaign (a sold bond, an open and a closed settlement, a frozen draw, …). The realistic-data E2E sweep (`tests/e2e/realistic-data.spec.ts`) uses it. The removed walkthrough also used this list during the redesign.
