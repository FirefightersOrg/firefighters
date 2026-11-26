# UX redesign

Working documents of the frontend and UX/UI redesign (coordinated in #50).

| File                           | What it is                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| [`audit.md`](audit.md)         | What was wrong, ordered by impact, with evidence, cause and a proposal for each item    |
| [`direction.md`](direction.md) | The vision: principles, navigation, patterns per kind of screen, prototypes, proposals  |
| [`plan.md`](plan.md)           | The list of small PRs, in order, with scope, acceptance criteria and risk for each      |
| [`results.md`](results.md)     | Before and after for every measured flow and screen, and what became of each audit item |

## Where the evidence went

The redesign produced about 100 MB of evidence that the repository does not need to carry: the screenshots of every screen before (`docs/ux/before/`) and after (`docs/ux/after/`, with the screenshots of each PR), the static prototypes (`docs/ux/prototypes/`), and the two scripts that measured (`scripts/ux-walkthrough.ts`, `scripts/ux-flows.ts`, with their guard `scripts/ux-local.ts`). PR 20 of the plan removed them from the tree. The numbers they produced are written in `audit.md` and `results.md`.

Everything is still in the history. The last commit that has all of it is `d10234d` (the merge of #192):

```sh
git show d10234d:docs/ux/after/report.json                   # one file
git checkout d10234d -- docs/ux/before docs/ux/after         # the screenshots, back in the working tree
git checkout d10234d -- scripts/ux-walkthrough.ts scripts/ux-flows.ts scripts/ux-local.ts
```

The documents name those files by the path they had (`docs/ux/before/admin/375-light/42-settlement-open.jpg`). To run the scripts again, restore them as above and follow the README of that commit (`git show d10234d:docs/ux/README.md`): they need the local stack, `pnpm seed:demo` and a local server.

## What stays for the tests

### `pnpm seed:demo` (`scripts/seed-demo.ts`)

Loads the campaign «Bono Contribución 2026» through the same audited SQL functions the app calls, signed in as the seeded admin: 6 collectors (the first one linked to the fixture collector user, so the portal has data), 90 buyers, 240 bonds, 12 delivery notes, 147 sales (a quarter paid in full, the rest in 6 installments, sold over the last four months), 12 closed settlements and 3 open ones, two payments sent from the portal (one still unprocessed), a ledger adjustment, 3 returned bonds, a lost bond and three draws (frozen roster with a delivered and an unawarded prize, roster generated, scheduled). It also creates a second campaign in draft. Numbers come from a seeded generator, so a clean database always gets the same campaign. It does nothing if the campaign already exists.

### `scripts/demo-screens.ts`

The list of screens, addressed with records of the demo campaign (a sold bond, an open and a closed settlement, a frozen draw, …). The realistic-data E2E sweep (`tests/e2e/realistic-data.spec.ts`) uses it, and the walkthrough of the redesign visited the same screens. A new screen is added here once.
