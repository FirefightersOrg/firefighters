# Implementation plan

How the direction in [`direction.md`](direction.md) becomes code: a list of small PRs, in order. Shared foundations first (Cimiento, the shell), then one screen or one family of screens per PR, starting with what the audit scored highest. Items A1 to A15 are in [`audit.md`](audit.md).

Santi approved the plan on 2026-11-26 and answered its three open points (see [Decisions](#decisions)). Implementation starts when #159 is approved on GitHub and merged.

## Rules for every PR

- One branch per PR, cut from an up-to-date `origin/main`. Never more than two UI PRs open at once.
- No changes to business logic, SQL, migrations, permissions or service contracts. A route's `load` may read more of what the caller is already allowed to read; a form keeps its action and its fields.
- Cimiento changes (tokens, base components) go in their own PR, before the screens that use them, with their page in `docs/design-system/components/` and their example in `/dev/ui`.
- Interface text in Spanish, no voseo, following `docs/copy.md`. Amounts in whole pesos on screens, with cents on documents and ledgers.
- Checked in the browser by the author at 375 px and 1280 px, in light and dark, with the demo campaign (`pnpm seed:demo`). Before and after screenshots in the PR.
- Tests: render tests for what changes, E2E for the flows it touches, the axe sweep in light and dark, 375 px and keyboard.
- Before pushing, from a clean database and with `origin/main` merged in: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm db:test` (or `pnpm db:test:parallel`), `pnpm test:integration`, `pnpm test:e2e`, all passing. The PR states the numbers.
- The PR links the audit items it closes and asks `juanigm` for review. It merges when he approves the last commit and the PR is clean.
- The four questions, answered on the real screen before asking for review: does a treasurer in a hurry understand it in 5 seconds; can a collector use it one-handed on the sidewalk; is it impossible to mix up an amount or a bond number; does it look made for this fire station.

## Order at a glance

| PR  | What                                                                | Audit items  | Risk   |
| --- | ------------------------------------------------------------------- | ------------ | ------ |
| 1   | Realistic-data check in the E2E sweep                               | A7           | Low    |
| 2   | Cimiento: navy dark palette                                         | A14          | Low    |
| 3   | Cimiento: bond number, money, status marks, sheet                   | A4, A10      | Low    |
| 4   | Cimiento: rows, responsive table, filters, two-way choice, task bar | A7           | Medium |
| 5   | Campaign shell: top bar, rail, tab bar                              | A2, A10      | High   |
| 6   | Error pages, home redirect, back link                               | A11, A13     | Low    |
| 7   | Open settlement: payments by bond number                            | A1, A4, A8   | High   |
| 8   | Bond record                                                         | A3, A10      | Medium |
| 9   | Bonds list and bond search                                          | A7, A10, A15 | Medium |
| 10  | Portal: shell, «Por cobrar» and collecting                          | A5, A11      | High   |
| 11  | Portal: bonds, sales, buyers, account                               | A5           | Low    |
| 12  | Register a sale, and the sale record                                | A6, A8, A9   | High   |
| 13  | Campaign home                                                       | A7, A10      | Medium |
| 14  | Lists: sales, settlements, deliveries, people, draws                | A7, A9       | Medium |
| 15  | Collector and buyer records, current account                        | A12          | Medium |
| 16  | Deliveries and draws                                                | A15          | Low    |
| 17  | Reports, audit, commissions and administration                      | A7, A10, A12 | Medium |
| 18  | Printable documents                                                 | A7           | Low    |
| 19  | Wrap-up: after walkthrough, design-system and copy docs             | all          | Low    |
| 20  | Clean-up: remove the screenshots and working files from the repo    |              | Low    |

PRs 2, 3 and 4 are Cimiento only. 5 and 6 are the shell. From 7 on, each PR is a screen or a family of screens, highest impact first. With two PRs open at a time, a Cimiento or low-risk PR runs beside a screen PR, never two high-risk ones.

## Foundations

### PR 1. Realistic-data check in the E2E sweep

- **Why first.** The audit's overflow and length problems pass today's E2E because its campaign has two bonds and four-digit amounts. Every later PR needs a check that fails on real data.
- **Scope.** `tests/e2e/`: a second sweep that loads the demo campaign (`scripts/seed-demo.ts`, changed to export its seeding function) and checks, at 375 px in light, every staff and portal route for horizontal page overflow. Screens that overflow today go on a `KNOWN_OVERFLOW` list with the audit item beside each. No app code.
- **Screens.** None change.
- **Acceptance.**
  - The sweep fails if any route not on the list overflows at 375 px.
  - The list holds exactly the routes the audit measured: campaign page, bonds list, financial reports, settlement print.
  - It fails if a listed route stops overflowing, so each fix has to remove its entry.
  - `pnpm test:e2e` passes; the run time grows by less than two minutes.
- **Risk.** Low. More E2E time; the seed runs once per sweep.

### PR 2. Cimiento: navy dark palette (P3)

- **Scope.** `docs/design-system/tokens.json`, `src/lib/styles/tokens.css` (both dark blocks), the dark `theme-color` in `src/app.html`, `static/offline.html`, `docs/design-system/README.md` («Tema oscuro»). Values as in `prototypes/proto.css`.
- **Screens.** Every screen, in dark only.
- **Acceptance.**
  - `tokens.test.ts` passes (JSON and CSS match, in both dark blocks).
  - The axe sweep passes in dark on every route.
  - The README lists the measured contrast of each text pair (all 4.5:1 or more; control borders 3:1 or more).
  - Light mode is pixel-identical: the light screenshots of five screens before and after are attached.
- **Risk.** Low. A token-only change; the sweep covers contrast.

### PR 3. Cimiento: bond number, money, status marks, sheet

- **Scope.** New in `src/lib/components/ui/`:
  - `BondNumber`: base number zero-padded in the figure face, optional associated number after it, three sizes, optional link.
  - `Money`: `formatMoney` with one prop for the context (`screen` whole pesos, `document` with cents), never breaking between `$` and the amount, with a sign and a word for negatives.
  - `StatusBadge` and `Badge`: a mark whose shape changes with the tone (round, diamond, square).
  - `MoneySheet`: the lines, subtotal rule, double rule and lead figure of the closed settlement, extracted from `settlements/[settlementId]/+page.svelte` so it can be reused.
  - `BondStub` moves from `components/draws/` to `ui/` unchanged, with a size prop.
- **Screens.** The closed settlement and the winners page use the extracted components and must look the same. `/dev/ui` shows all of them.
- **Acceptance.**
  - Render tests for each component (padding, sizes, negative amounts, shapes per tone, accessible names).
  - The closed settlement's and the winners page's existing render tests and E2E pass unchanged.
  - A component page for each in `docs/design-system/components/`.
  - The palette guardrail passes.
- **Risk.** Low. Two existing screens are refactored without visual change; their tests guard it.

### PR 4. Cimiento: rows, responsive table, filters, two-way choice, task bar

- **Scope.** New or extended in `ui/`:
  - `RowList`: two-line rows (identifier and main fact, state and amount), the whole row a link, 56 px minimum.
  - `Table`: a `stack` option that renders each row as a `RowList` item under 720 px, driven by two column roles (`primary`, `secondary`); and its scroll container no longer grows with the table.
  - `FilterBar`: one search field, the other filters folded under «Filtrar» with a count, applied filters as removable chips. Works without JavaScript (it is a GET form).
  - `SegmentedControl`: a radio group drawn as adjacent buttons, for choices of two or three.
  - `TaskBar`: the bar fixed to the bottom of a focused task on phones (a figure and one action), which becomes a normal block on desktop.
  - `RowActions`: one «…» control per row that opens a menu; the destructive entries open a `Dialog`.
- **Screens.** `/dev/ui` only. No route adopts them in this PR.
- **Acceptance.**
  - Render tests: stacked rows keep every cell reachable by a screen reader; the filter form submits the same query string as today's forms; the segmented control is operable with arrow keys; the menu closes with Esc and returns focus.
  - axe passes on `/dev/ui` in light and dark; every control is 44 px or more at 375 px.
  - A component page for each.
- **Risk.** Medium. `Table` is used by every list; the new option is off by default, and the scroll-container fix is checked against the existing sweep.

### PR 5. Campaign shell: top bar, rail, tab bar (P1, P2)

- **Scope.**
  - `AppHeader`: the institution's name from `PUBLIC_INSTITUTION_NAME` (P1), the campaign as context, a bond search (a GET to `/campaigns/[id]/bonds?base=`, as the campaign page does today), the session.
  - A new `campaigns/[id]/+layout.svelte` (and its `+layout.server.ts`, which loads the campaign name, its status and the count of open settlements with the caller's permissions) that renders the left rail from 1024 px and the bottom tab bar below it, with «Más» opening the remaining sections.
  - `src/lib/navigation.ts`: the campaign sections and their permissions move here from `campaigns/[id]/+page.svelte`, which stops rendering them.
  - Page titles use the institution's name.
- **Screens.** Every screen under `/campaigns/[id]`.
- **Acceptance.**
  - From any campaign screen, any section the role may open is one tap away at 375 px and one click away at 1280 px.
  - The rail and the tabs show exactly the sections today's links show for each of the five roles (a unit test per role on `navigation.ts`).
  - The current section is marked with the yellow bar and weight 600 and has `aria-current="page"`.
  - Print routes (`+page@.svelte`) are unaffected.
  - The tab bar does not cover content: the last control of every page is reachable at 375 px (checked by the sweep).
  - Keyboard: a skip link to the content; Tab order is top bar, navigation, content.
  - The E2E helpers and flows pass; the a11y sweep passes on every route in light and dark.
- **Risk.** High. It touches every campaign screen and the layout data. Mitigation: no page content changes in this PR beyond removing the section links; the campaign page keeps everything else until PR 13.

### PR 6. Error pages, home redirect, back link

- **Scope.**
  - `+error.svelte` at the root, under `/campaigns/[id]` and under `/portal`: what happened, in Spanish, inside the shell, with the way back. A 403 says which area it is («Esta sección es de tesorería»), from a map of route to label.
  - `/`: signed-in staff go to the active campaign when there is exactly one, otherwise to `/campaigns`. The session card moves to a «Mi cuenta» entry in the top bar.
  - `PageHeader`: one back link to the parent section instead of the breadcrumb trail (the `breadcrumbs` prop stays accepted, and the last parent becomes the link, so pages do not all change in this PR).
- **Screens.** Home, every 403 and 404, every page header.
- **Acceptance.**
  - A 403 and a 404 under a campaign render the shell, a message in Spanish and a link that works; none contains the words «Forbidden» or «Not Found».
  - Signing in as admin with one active campaign lands on that campaign in one navigation; with two, on the list.
  - The collector still lands on the portal.
  - Route tests for the three landings; a render test for the error page per status.
- **Risk.** Low. The redirect is the only behavior change; it is covered by route tests.

## Screens, by impact

### PR 7. Open settlement: payments by bond number (A1, A4, A8, P4)

- **Scope.** `settlements/[settlementId]/+page.svelte` in its open state, and the «Registrar pago» action on the campaign page.
  - Entry by bond number: the number is matched in the browser against `data.candidates`; the buyer, the debt and the installments appear with the next one checked; the method is a `SegmentedControl`; the button names the amount. It posts to the same `?/add` action with the same fields.
  - Enter on the number finds; Enter again adds; after adding, the row appears first in the list and focus returns to the number.
  - The live `MoneySheet` beside the form on desktop, and the cash to hand over in a `TaskBar` on phones.
  - Each payment row shows the bond, the buyer, the installments and the method. `load` adds the bond and buyer of each payment (same permissions as `candidates`).
  - «Quitar» and «Corregir / anular» move into `RowActions`; each opens a dialog that asks for the reason. Same actions.
  - Collector-submitted payments: «Incluir» stays; «Rechazar» asks for the reason in a dialog.
  - «Cerrar rendición» is a primary button (P4); its dialog adds the cash to hand over. While something blocks it, it is disabled with the reason under it.
  - «Registrar pago» on the campaign page: goes to the collector's open settlement, or to «Abrir rendición» with the collector chosen.
- **Screens.** Open settlement; campaign page (one action).
- **Acceptance.**
  - Recording a second payment on an open settlement takes: type the number, Enter, Enter. `scripts/ux-flows.ts` reports 9 actions or fewer for the settlement flow (12 today) and 6 screens (8 today).
  - At 375 px nothing in the entry form is cut and the page does not scroll sideways, with 25 payments loaded.
  - Every payment row names its bond; a row whose buyer the role cannot read shows the bond alone (no «Unknown»).
  - A number that is not one of the collector's sales says so next to the field and adds nothing.
  - The money-flow E2E passes with its selectors updated; a new E2E covers number, Enter, Enter, and removing a payment through the dialog.
  - The closed settlement is unchanged.
- **Risk.** High: the money flow. Mitigation: same actions and fields, so server tests do not change; the E2E covers add, remove, include, reject and close; the amount in the button and in the sheet come from the same cents arithmetic as #147.
- **Depends on.** PRs 3, 4, 5. Not on #160: without it, a treasurer sees bond numbers without names. Not on #162: the date field is added when that ticket lands.

### PR 8. Bond record (A3, A10)

- **Scope.** `bonds/[bondId]/+page.svelte` and `components/bonds/record/`.
  - Header: the `BondStub`, the sentence built from data (state, buyer, collector, installments paid, debt, overdue), the state badges.
  - One next step by state: available «Entregar», delivered «Registrar venta», sold with debt «Registrar pago», none when paid, lost or annulled.
  - Body: installments with the amount still owed as the lead figure; draws; who has it.
  - Collapsed: deliveries and returns, recorded movements (with words instead of action codes), «Corregir o anular» with the existing actions behind dialogs.
  - `load` adds the names of the current collector and buyer and the buyer's phone, read with the caller's permissions.
  - `BondPartySection`, `BondPendingSection` and the phase notes are removed.
- **Screens.** Bond record in its states: available, delivered, sold (up to date, overdue, paid), lost, annulled, pata.
- **Acceptance.**
  - The buyer's and the collector's names are in the first screenful at 375 px for a sold bond, as links only when the role can open them.
  - No text on the record contains «fase».
  - The record of a sold bond is 2.5 screens or shorter at 375 px (5.5 today).
  - Every existing action (correct collector, return, reassign, mark lost, annul) is reachable and its server tests pass unchanged.
  - Render tests for the sentence in each state, including a role that cannot read the buyer.
- **Risk.** Medium. Many states; the sentence has to be right in each. A table of state to sentence is in the PR and in the render test.
- **Depends on.** PRs 3, 5.

### PR 9. Bonds list and bond search (A7, A10, A15)

- **Scope.** `bonds/+page.svelte`: `FilterBar` (number first, the rest folded), stacked rows under 720 px, the collector and the buyer on each row, the disabled «Asignar a cobrador» and its «Fase 6» label removed (delivery has its own screen). The search in the top bar and on the campaign page opens the record directly when exactly one bond matches (a redirect in the bonds list `load`, only when the request carries `base` and nothing else).
- **Screens.** Bonds list, its search and empty states.
- **Acceptance.**
  - No horizontal page scroll at 375 px with 240 bonds; the entry leaves `KNOWN_OVERFLOW`.
  - Searching «181» from any campaign screen reaches the record in 2 screens (3 today).
  - The first row is visible in the first screenful at 375 px.
  - The existing filters produce the same query strings and the same results (`page.server.test.ts` unchanged).
- **Risk.** Medium. The single-match redirect changes what a search does; a search with no match or several keeps the list.
- **Depends on.** PRs 3, 4, 5.

### PR 10. Portal: shell, «Por cobrar» and collecting (A5, A11, P5, Q4)

- **Scope.** `/portal/**`, routes unchanged.
  - The shell with the portal's five tabs, «Por cobrar» first (replaces `PortalNav`).
  - `/portal`: lists only campaigns that are active or closing (a campaign in closing still takes payments) and, with exactly one, goes to its «Por cobrar» (P5, Q4). None: an empty state that says so.
  - «Por cobrar»: items grouped into overdue and due this week, each with the bond, the buyer, the installment, the amount, «Llamar» (`tel:`) and «Cobrar».
  - «Cobrar» opens the payment form in a sheet with the amount, cash and today filled in; it submits `RegisterPaymentForm`'s fields to the existing `?/registrar` action of the sale. If that cannot be done from the list without a server change, «Cobrar» links to the sale with the form open on that installment.
  - The sale page: the form leaves the table cell; installments as rows; one line of totals.
  - A sent payment stays in the list as «Enviado».
- **Screens.** Portal home, «Por cobrar», sale.
- **Acceptance.**
  - `scripts/ux-flows.ts` reports 3 taps and 3 screens to send a payment (6 and 7 today), or 4 and 4 with the fallback.
  - At 375 px nothing is cut on «Por cobrar» or on the sale, and every phone number is a `tel:` link.
  - A collector with one active and one draft campaign lands on «Por cobrar» of the active one and is never offered the draft. A campaign in closing is listed; a closed or annulled one is not.
  - The Phase 16 acceptance suite and `portal-a11y.spec.ts` pass, with the landing expectation updated.
  - The action's request (fields and values) is byte-identical to today's (asserted in the route test).
- **Risk.** High: the collector's only screen, and money. The `load` of `/portal` changes (approved as P5 and Q4).
- **Depends on.** PRs 3, 4, 5.

### PR 11. Portal: bonds, sales, buyers, account (A5)

- **Scope.** The remaining portal pages as stacked rows, with `BondNumber`, `Money` and the status marks; «Mi cuenta corriente» as a `MoneySheet` with its movements below.
- **Screens.** Mis bonos, bond, Mis ventas, Mis compradores, buyer, Mi cuenta corriente.
- **Acceptance.** No table scrolls sideways at 375 px; the balance and its explanation are in the first screenful of the account; the portal suites pass.
- **Risk.** Low. Read-only screens.
- **Depends on.** PR 10.

### PR 12. Register a sale, and the sale record (A6, A8, A9)

- **Scope.**
  - `sales/new/+page.svelte`: the found bond is kept in page state; the buyer is found by typing (the existing `?buyer=` search, fetched without leaving the page, matches listed under the field); answered steps collapse to a line; a single match is selected; the payment mode is a `SegmentedControl`; `?bond=` arrives with the bond searched; the button names the bond and the buyer.
  - `sales/[saleId]/+page.svelte`: the plan first, with what is owed as the lead figure; «Marcar como incobrable» and the corrections under «Corregir o anular», each in a dialog.
  - A buyer or a collector the role cannot read shows «Sin acceso al comprador» with no link (the Spanish fallback from A9), here and in the shared label helper.
- **Screens.** New sale, sale record.
- **Acceptance.**
  - Searching for a buyer after choosing the bond keeps the bond (the probe flow in `ux-flows.ts` reports it kept).
  - The sale flow is 6 actions and 4 screens or fewer (7 and 5 today).
  - Without JavaScript the form still registers a sale (the search falls back to today's GET).
  - No screen shows «Unknown buyer» or «Unknown collector» for any role (a crawl in the E2E sweep asserts it).
  - The sale's actions and their server tests are unchanged.
- **Risk.** High: state kept in the browser across a search. Covered by an E2E that searches the buyer after the bond and by the no-JavaScript route test.
- **Depends on.** PRs 3, 4, 5.

### PR 13. Campaign home (A7, A10)

- **Scope.** `campaigns/[id]/+page.svelte`: the bond search and the four day's actions, «Para resolver» (unprocessed collector payments, bonds left out of the next draw, open settlements), one line of figures, collector balances and the next draw as ruled lists. Whole pesos throughout. A draft campaign keeps «Activar» first; the close checklist stays at the end.
- **Screens.** Campaign home in draft, active, closing and closed.
- **Acceptance.**
  - 2.5 screens or shorter at 375 px with the demo campaign (5.2 today); no horizontal scroll (leaves `KNOWN_OVERFLOW`).
  - Each «Para resolver» item links to the screen that resolves it and disappears when there is nothing to resolve.
  - No amount on the page has cents.
  - `load` returns the same keys (`phase-2-acceptance` unchanged) plus, at most, counts read with existing permissions.
- **Risk.** Medium. The page is each role's landing; a render test per role.
- **Depends on.** PRs 3, 4, 5, 7 (the «Registrar pago» action).

### PR 14. Lists: sales, settlements, deliveries, people, draws (A7, A9)

- **Scope.** The list pattern on `sales`, `settlements` (open ones first), `deliveries`, `collectors`, `buyers` and `draws`: `FilterBar`, stacked rows, `BondNumber` and `Money`, the Spanish fallback for unreadable names.
- **Screens.** Six lists.
- **Acceptance.** At 375 px each list shows its first row in the first screenful and never scrolls sideways; every filter keeps its query string; open settlements come before closed ones; the list server tests are unchanged.
- **Risk.** Medium by volume. If the diff passes 800 lines it is split in two (operation lists, then people and draws).
- **Depends on.** PR 4.

### PR 15. Collector and buyer records, current account (A12)

- **Scope.** `collectors/[collectorId]`, its `ledger`, and `buyers/[buyerId]`: header with the sentence and the next step, the first 10 rows of each inner list with a link to the filtered list, the current account as a `MoneySheet` over its movements, bulk return and reassignment behind «Corregir o anular».
- **Screens.** Collector record, current account, buyer record.
- **Acceptance.** The collector record is 3 screens or shorter at 375 px with 35 bonds and 54 pending installments (12.9 today); the balance is in the first screenful; every existing action keeps working with its tests unchanged.
- **Risk.** Medium. The bulk actions select from a list that is now partial: they move to the filtered bonds list, which already shows the collector.
- **Depends on.** PRs 9, 14.

### PR 16. Deliveries and draws (A15)

- **Scope.**
  - New delivery: added bonds shown as compact ranges («0211 a 0215, 5 bonos») with one remove control per range; the button names the count and the collector; the note record with «Imprimir» as its primary action.
  - Draws: on each state of a draw the next step is a button (generate, freeze, load winners); «Registrar resolución» names the outcome («Adjudicar el premio», «Dejar sin adjudicar»); the roster as stacked rows.
- **Screens.** New delivery, delivery note, draw record, roster, winners.
- **Acceptance.** Delivering 35 bonds keeps the submit button within 2 screens at 375 px; the delivery and draw flows keep their action counts (7 and 19) or lower; the draw-flow E2E passes with selectors updated.
- **Risk.** Low. Same actions; the draw screens were redesigned in #148.
- **Depends on.** PRs 3, 4.

### PR 17. Reports, audit, commissions and administration (A7, A10, A12)

- **Scope.**
  - Reports: one section per view (tabs that are links, so each has its URL), totals first, exports beside them; the export buttons no longer overflow.
  - Audit: action and entity in words, the bond or person each entry is about, a filter by person's name; the codes stay available in «Detalle».
  - Commissions, «Datos y reglas» and backups: brought to the patterns (no nested cards, whole pesos, actions behind dialogs).
- **Screens.** Operational and financial reports, audit, commissions, data and rules, backups.
- **Acceptance.** No report view is longer than 6 screens at 375 px (38.7 today); the financial reports leave `KNOWN_OVERFLOW`; every export downloads the same file as before (existing tests); no audit row shows a code outside «Detalle».
- **Risk.** Medium. Report URLs change shape (a view parameter); old URLs keep working.
- **Depends on.** PR 4.

### PR 18. Printable documents (A7)

- **Scope.** `src/lib/styles/print.css` and the print routes: the sheet idiom and figure type on the delivery note, the settlement note and the payment and prize certificates; bond numbers in a grid; the settlement note no longer overflows at 375 px.
- **Screens.** The five printable documents.
- **Acceptance.** Each document fits A4 in the print preview with the demo data; the settlement print leaves `KNOWN_OVERFLOW`, which is then empty and deleted; legends for annulled and corrected documents are unchanged (existing tests).
- **Risk.** Low. Documents carry legal weight: no text or figure changes, only layout.

### PR 19. Wrap-up (phase 4)

- **Scope.** `docs/ux/after/` (the walkthrough and the flows again), `docs/design-system/README.md` and `docs/copy.md` updated, the last «·» and em-dash labels removed, and the summary for #50.
- **Acceptance.** A table of before and after for every measured flow and screen length; the audit's items each marked done, moved to a ticket, or still open with the reason.

## What this plan does not include

- #160, #161 and #162 (treasurer permissions, the ledger 404, the payment date): they change SQL, permissions or an action's contract. The screens above work without them and improve when they land.
- The backend proposals B1, B2, B4 and B5 in `direction.md`, still undecided.
- Changes to what each role may do.

### PR 20. Clean-up

- **Why.** The screenshots are evidence for the redesign, not something the repo needs to carry afterwards (about 35 MB before, and as much again after).
- **Scope.** After PR 19 is merged and its summary is posted in #50: remove `docs/ux/before/`, `docs/ux/after/` and `docs/ux/prototypes/` from the tree, and `scripts/ux-walkthrough.ts` and `scripts/ux-flows.ts`. Keep `audit.md`, `direction.md`, `plan.md` and the final before-and-after table (with its numbers written in the document, since the images will be gone), and keep `scripts/seed-demo.ts` (`pnpm seed:demo`), which the E2E sweep from PR 1 uses.
- **Acceptance.** No image is left under `docs/ux/`; no document links to a removed file; `pnpm lint` and `pnpm test:e2e` pass.
- **Note.** Removing files does not shrink the repository's history. Rewriting `main` to drop them is possible but is a separate decision (it changes every commit hash after #159), and is not part of this PR.

## Decisions

Answered by Santi on 2026-11-26:

1. **Closing campaigns in the portal (PR 10).** Listed too: active and closing.
2. **Read-only and names (#160).** Yes, read-only also reads collector and buyer names. The grant is part of #160; until it lands the role gets the Spanish fallback.
3. **Order.** As planned: the open settlement (PR 7) before the bond record and the portal. Nobody is using the app yet, so there is no reason to move the portal ahead; the settlement is the most frequent task, and the portal's payment sheet reuses what it builds.
4. **Tickets.** The redesign's PRs do not get tickets. #160, #161 and #162 are tracked in Linear by Juan.
5. **Clean-up.** The screenshots and working files leave the repo at the end (PR 20).
