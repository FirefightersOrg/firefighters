# UX redesign

Working documents of the frontend and UX/UI redesign (coordinated in #50).

| File                           | What it is                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| [`audit.md`](audit.md)         | What is wrong today, ordered by impact, with evidence, cause and a proposal for each item |
| [`direction.md`](direction.md) | The vision: principles, navigation, patterns per kind of screen, prototypes, proposals    |
| [`plan.md`](plan.md)           | The list of small PRs, in order, with scope, acceptance criteria and risk for each        |
| [`before/`](before/)           | Screenshots and measurements of every screen before the redesign                          |
| [`prototypes/`](prototypes/)   | Static HTML prototypes of the four key screens, with screenshots in `shots/`              |
| `after/`                       | The same walkthrough after the redesign (phase 4)                                         |

## Reproducing the evidence

Everything runs against the local stack and never against a remote one. The scripts refuse to run unless `APP_ENV=local` and the Supabase URL is on localhost, and the two browser scripts also refuse a `UX_BASE_URL` that is not on localhost, because they sign in with the seed credentials (`scripts/ux-local.ts`).

```sh
pnpm db:reset
APP_ENV=local pnpm seed:admin          # retry until auth is up
APP_ENV=local pnpm seed:demo           # one realistic campaign, see below
pnpm dev --host 127.0.0.1 --port 5173  # in another terminal

APP_ENV=local pnpm exec tsx scripts/ux-walkthrough.ts docs/ux/before
APP_ENV=local pnpm exec tsx scripts/ux-flows.ts docs/ux/before/flows
```

### `pnpm seed:demo` (`scripts/seed-demo.ts`)

Loads the campaign «Bono Contribución 2026» through the same audited SQL functions the app calls, signed in as the seeded admin: 6 collectors (the first one linked to the fixture collector user, so the portal has data), 90 buyers, 240 bonds, 12 delivery notes, 147 sales (a quarter paid in full, the rest in 6 installments, sold over the last four months), 12 closed settlements and 3 open ones, two payments sent from the portal (one still unprocessed), a ledger adjustment, 3 returned bonds, a lost bond and three draws (frozen roster with a delivered and an unawarded prize, roster generated, scheduled). It also creates a second campaign in draft. Numbers come from a seeded generator, so a clean database always gets the same campaign. It does nothing if the campaign already exists.

### `scripts/demo-screens.ts`

The list of screens, addressed with records of the demo campaign (a sold bond, an open and a closed settlement, a frozen draw, …). The walkthrough and the realistic-data E2E sweep (`tests/e2e/realistic-data.spec.ts`) both use it, so they visit the same screens. A new screen is added here once.

### `scripts/ux-walkthrough.ts`

Signs in as each role (admin, treasurer, operator, read-only, collector) and opens every screen at 375 px and 1280 px, in light and dark. For each capture it writes a row in `report.json`: HTTP status, final path, page title and heading, page length in screens, horizontal overflow in pixels, and the number of controls, links and tables.

To keep the folder small, screenshots are saved in full for the admin and the collector. For treasurer, operator and read-only they are saved only in light and only where the screen differs from the admin's (a different status, heading or number of controls or links); the report still has a row for every screen. Pages longer than eight screens are cut there.

```txt
before/<role>/<width>-<scheme>/<nn>-<screen>.jpg
before/report.json
```

### `scripts/ux-flows.ts`

Runs the critical flows on a 375 px screen and counts what each costs: screens the person has to read, taps, fields typed and choices made. It saves a screenshot per screen and `flows.json`. It writes data (a sale, payments, a closed settlement, a delivery, a draw, a collector payment), so reset and reseed before running it again. If a flow fails, its entry in `flows.json` is marked `failed` and the script exits with status 1, so an incomplete run cannot pass for a good one.

```txt
before/flows/<flow>/<nn>-<screen>.jpg
before/flows/flows.json
```
