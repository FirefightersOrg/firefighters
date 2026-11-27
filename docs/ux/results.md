# UX redesign: results

What the redesign changed, measured the same way as the audit ([`audit.md`](audit.md)), and what became of each audit item. Written at the end of phase 3 (2026-11-26), with every PR of [`plan.md`](plan.md) from 1 to 18 merged.

## How it was measured

> The captures, both reports and the two scripts left the tree in PR 20; this document keeps the numbers. See [«Where the evidence went»](README.md#where-the-evidence-went).

The same two scripts as before, on the same demo campaign (`pnpm seed:demo`: 240 bonds, 147 sales, 15 settlements), against a production build of `main` at `90bc176`, in a clean database:

- `scripts/ux-walkthrough.ts` opens every screen as every role at 375 px and 1280 px, in light and dark, and records its length in phone screens (812 px) and how far the page scrolls sideways. 896 captures, as before. The files were in `docs/ux/after/` with the same layout as `docs/ux/before/`, and `after/report.json` had every row.
- `scripts/ux-flows.ts` runs the critical flows at 375 px and counts the screens the person reads and the actions (taps, fields typed, choices). The steps were in `after/flows/`.

Two limits of these numbers. The length of a page says nothing about whether the first screen answers the question, which is what most of the work was about. And «sideways scroll» is measured on the page: before, several tables did not move the page but scrolled inside their card with their columns cut, and that does not show in the «before» column.

## Critical flows

| Flow                                                    | Screens before | After | Actions before | After |
| ------------------------------------------------------- | -------------- | ----- | -------------- | ----- |
| Search for a bond                                       | 3              | 2     | 3              | 2     |
| Register a sale (existing buyer, in installments)       | 5              | 5     | 7              | 6     |
| Search for the buyer after finding the bond             | 2              | 2     | 5              | 4     |
| Open a settlement, record two payments, close it, print | 8              | 8     | 12             | 12    |
| Deliver a range of bonds and print the note             | 5              | 5     | 7              | 7     |
| Create a draw, roster, freeze, load a winner, award it  | 10             | 10    | 19             | 18    |
| Collector sends one payment from the portal             | 7              | 3     | 6              | 2     |

What the counts do not show:

- **Search for a bond.** The search is in the header of every page of a campaign, and one match opens the record.
- **Register a sale.** Searching for the buyer used to drop the bond that had been found; now it stays (the script's probe reports «The found bond survives the buyer search»). The button names the bond and the buyer.
- **Settlement.** The count is the same because number, Enter, Enter is three actions, as choose, check, tap was. What changed is what each one costs: a number typed instead of a list of every sale to read, the hands never off the keyboard, and who pays and how much on screen before the second Enter. Every payment in the list names its bond.
- **Deliver bonds.** Same count; the bonds are shown as ranges and the button says «Entregar 35 bonos a Jorge Medina».
- **Draw.** One tap fewer: with no prizes yet, the first prize's form is open. Each state of the draw has its next step as the button.
- **Portal.** The collector lands on «Por cobrar» and sends a payment from the list in a sheet.

## Screen lengths at 375 px

Staff screens, as admin (53 screens that answer 200):

|                                         | Before                                  | After                       |
| --------------------------------------- | --------------------------------------- | --------------------------- |
| Screens where the page scrolls sideways | 6                                       | 0                           |
| Screens longer than 3 phone screens     | 18                                      | 8                           |
| Longest screen                          | 38.7 (`82-reports-financial-collector`) | 9.5 (`44-settlement-print`) |
| Sum of all lengths                      | 181.1                                   | 112.2                       |

Across every role, width and theme, 42 of the 896 captures scrolled sideways before and none does now. The only console errors in the run are the browser's own for the pages a role may not open (403) and the not-found page (404). With the grants of #163 the treasurer opens 5 more screens than before and read-only 4 more, and the treasurer's 404 on the collector's account is gone.

The collector portal (12 screens) went the other way: the sum of its lengths was 22.5 and is 29.0, and three lists are now longer than 3 screens where none was. Its tables used to keep the page short by scrolling inside their card with columns cut; as stacked rows every row is readable and the list is longer. The same happens to the draw's roster (`75-draw-roster`, 1.5 to 5.7) and, a little, to the bonds and buyers lists. This is the trade the plan chose, and it is the main thing a reviewer may want to revisit (fewer rows per page on a phone would shorten them).

Other rows that got longer, and why:

- `00-home` (1 to 2.4): `/` now sends staff to the campaign home instead of showing a page with one link.
- `44-settlement-print` (5.2 to 9.5): the printable note no longer scrolls sideways on a phone, so it is taller there. It is a document for paper: PR 18 checks its page count when printed.
- `31-sale-new` (1.6 to 2.8): the form shows the buyers found and the plan of installments on the page instead of behind selects.
- `p0-portal-home` (1 to 2.6): it is now the list of what there is to collect.

### Staff screens (admin), 375 px

| Screen                           | Screens long, before | After    | Sideways scroll before (px) | After |
| -------------------------------- | -------------------- | -------- | --------------------------- | ----- |
| `00-home`                        | 1                    | 2.4      | 0                           | 0     |
| `01-campaigns-list`              | 1                    | 1        | 0                           | 0     |
| `02-campaign-new`                | 3.1                  | 3.1      | 0                           | 0     |
| `03-campaign-workbench`          | 5.2                  | 2.4      | 26                          | 0     |
| `04-campaign-draft`              | 3.1                  | 1.5      | 0                           | 0     |
| `05-campaign-data-and-rules`     | 2.2                  | 2.3      | 0                           | 0     |
| `10-bonds-list`                  | 3.4                  | 3.7      | 419                         | 0     |
| `11-bonds-search-result`         | 1.8                  | 2.1      | 419                         | 0     |
| `12-bonds-search-empty`          | 1.8                  | 1        | 0                           | 0     |
| `13-bond-sold`                   | 5.5                  | 2.1      | 0                           | 0     |
| `14-bond-available`              | 5.2                  | 1.3      | 0                           | 0     |
| `15-bond-lost`                   | 5.1                  | 1.2      | 0                           | 0     |
| `16-bond-new`                    | 1.3                  | 1.3      | 0                           | 0     |
| `17-pata-new`                    | 1.6                  | 1.7      | 0                           | 0     |
| `18-bonds-scan`                  | 1                    | 1        | 0                           | 0     |
| `19-bonds-import`                | 1.6                  | 1.6      | 0                           | 0     |
| `20-deliveries-list`             | 2.1                  | 1.9      | 0                           | 0     |
| `21-delivery-new`                | 1.6                  | 1.2      | 0                           | 0     |
| `22-delivery-note`               | 1.6                  | 1        | 0                           | 0     |
| `23-delivery-note-print`         | 3.4                  | 2.3      | 0                           | 0     |
| `30-sales-list`                  | 3.7                  | 3.6      | 0                           | 0     |
| `31-sale-new`                    | 1.6                  | 2.8      | 0                           | 0     |
| `32-sale-detail`                 | 2.9                  | 1.4      | 0                           | 0     |
| `40-settlements-list`            | 2.2                  | 1.9      | 0                           | 0     |
| `41-settlement-new`              | 1                    | 1        | 0                           | 0     |
| `42-settlement-open`             | 4.1                  | 2.7      | 0                           | 0     |
| `43-settlement-closed`           | 3                    | 3.1      | 0                           | 0     |
| `44-settlement-print`            | 5.2                  | 9.5      | 81                          | 0     |
| `45-payment-print`               | 1                    | 1        | 0                           | 0     |
| `50-collectors-list`             | 1.3                  | 1.3      | 0                           | 0     |
| `51-collector-new`               | 1.1                  | 1.1      | 0                           | 0     |
| `52-collector-detail`            | 12.9                 | 3        | 0                           | 0     |
| `53-collector-ledger`            | 3.1                  | 2.6      | 0                           | 0     |
| `54-commissions`                 | 2.9                  | 1.8      | 0                           | 0     |
| `60-buyers-list`                 | 2.9                  | 3.5      | 0                           | 0     |
| `61-buyer-new`                   | 1.3                  | 1.4      | 0                           | 0     |
| `62-buyer-detail`                | 3.6                  | 2.8      | 0                           | 0     |
| `70-draws-list`                  | 1.1                  | 1        | 0                           | 0     |
| `71-draw-new`                    | 1.1                  | 1.1      | 0                           | 0     |
| `72-draw-scheduled`              | 1.3                  | 1.5      | 0                           | 0     |
| `73-draw-roster-generated`       | 1.4                  | 1.6      | 0                           | 0     |
| `74-draw-roster-frozen`          | 1.3                  | 1.3      | 0                           | 0     |
| `75-draw-roster`                 | 1.5                  | 5.7      | 0                           | 0     |
| `76-draw-winners`                | 1.7                  | 2        | 0                           | 0     |
| `77-prize-delivery-certificate`  | 1                    | 1        | 0                           | 0     |
| `78-prize-unawarded-certificate` | 1                    | 1        | 0                           | 0     |
| `80-reports-operational`         | 5.7                  | 2.1      | 0                           | 0     |
| `81-reports-financial`           | 10.1                 | 2.9      | 14                          | 0     |
| `82-reports-financial-collector` | 38.7                 | 2.7      | 14                          | 0     |
| `90-audit`                       | 5.2                  | 4.4      | 0                           | 0     |
| `91-backups`                     | 1.6                  | 1.3      | 0                           | 0     |
| `98-not-found`                   | HTTP 404             | HTTP 404 | —                           | —     |
| `p0-portal-home`                 | 1                    | 1        | 0                           | 0     |
| `p1-my-bonds`                    | 1                    | 1        | 0                           | 0     |

### Collector portal, 375 px

| Screen                  | Screens long, before | After    | Sideways scroll before (px) | After |
| ----------------------- | -------------------- | -------- | --------------------------- | ----- |
| `00-home`               | 1                    | 2.6      | 0                           | 0     |
| `01-campaigns-list`     | 1                    | 1        | 0                           | 0     |
| `02-campaign-new`       | HTTP 403             | HTTP 403 | —                           | —     |
| `03-campaign-workbench` | 1                    | 1        | 0                           | 0     |
| `p0-portal-home`        | 1                    | 2.6      | 0                           | 0     |
| `p1-my-bonds`           | 3                    | 3.7      | 0                           | 0     |
| `p2-my-bond`            | 1.7                  | 1.6      | 0                           | 0     |
| `p3-my-sales`           | 2.8                  | 4        | 0                           | 0     |
| `p4-my-sale`            | 2.8                  | 2.7      | 0                           | 0     |
| `p5-my-buyers`          | 2.5                  | 3.4      | 0                           | 0     |
| `p6-my-buyer`           | 1                    | 1        | 0                           | 0     |
| `p7-to-collect`         | 1.7                  | 2.6      | 0                           | 0     |
| `p8-my-account`         | 3                    | 2.8      | 0                           | 0     |

`98-not-found` answers 404 by design. The treasurer, operator and read-only rows were in `after/report.json`.

## The audit's items

| #   | Problem                                                             | Status                 | Where                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Recording a payment is slow and blind on a phone                    | Done                   | PR 7 (#173): payments by bond number, the totals as a sheet, the action in a bar at the thumb                                                                                                                                                                                                                                              |
| A2  | No navigation inside a campaign                                     | Done                   | PR 5 (#171): a rail on desktop, a tab bar on phones, the bond search in the header                                                                                                                                                                                                                                                         |
| A3  | The bond record does not say who has the bond or who bought it      | Done                   | PR 8 (#175)                                                                                                                                                                                                                                                                                                                                |
| A4  | Payments in a settlement cannot be identified                       | Done                   | PR 7 (#173): every payment names its bond, its buyer and its installments                                                                                                                                                                                                                                                                  |
| A5  | The portal does not work one-handed                                 | Done                   | PR 10 (#179), PR 11 (#180)                                                                                                                                                                                                                                                                                                                 |
| A6  | Registering a sale loses the bond, and buyers are hard to find      | Done                   | PR 12a (#184)                                                                                                                                                                                                                                                                                                                              |
| A7  | Lists on a phone: filters first, columns cut, sideways scroll       | Done                   | PR 9 (#177), PR 13 (#187), PR 14a (#189), PR 14b (#188), PR 17 (#182), PR 18 (#181). No page scrolls sideways at 375 px; the list of known exceptions in the E2E sweep is gone. Lists are longer on a phone, see above                                                                                                                     |
| A8  | Rare and risky actions on the main surface; red means «normal»      | Done                   | PR 7, PR 12b (#185), PR 15 (#191), PR 16 (#190), PR 17 (#182): collapsed, asked in a dialog with the reason; red only for what destroys                                                                                                                                                                                                    |
| A9  | Treasurer and read-only see «Unknown collector» and «Unknown buyer» | Done                   | The grant: #163 (issues #160 and #161). The Spanish stand-ins and the sweep over every screen and role: PR 12b (#185), made real in #187                                                                                                                                                                                                   |
| A10 | Words from how the system was built, and mixed money formats        | Done, with a remainder | Records open with sentences (PR 8, 12b, 15), summaries use whole pesos (PR 13, the lists), and PR 19 takes the last «·» and em-dash joins off the screens. Remainder: the four screens that load bonds (`bonds/new`, `pata/new`, `scan`, `import`) were never in the plan; they got the shell and the tokens, nothing else                 |
| A11 | After signing in there is a dead end before the work                | Done                   | PR 6 (#172) for staff, PR 10 (#179) for the collector                                                                                                                                                                                                                                                                                      |
| A12 | Records and reports are many screens long                           | Done                   | Bond record 5.5 to 2.1 (PR 8), collector record 12.9 to 3.0 (PR 15), buyer record 3.6 to 2.8, financial report by collector 38.7 to 2.7 (PR 17). Still over 3 screens: the audit (4.4) and the closed settlement (3.1)                                                                                                                     |
| A13 | Error pages are bare and in English                                 | Done                   | PR 6 (#172)                                                                                                                                                                                                                                                                                                                                |
| A14 | Dark mode looks like another product                                | Done                   | PR 2 (#165)                                                                                                                                                                                                                                                                                                                                |
| A15 | Smaller things                                                      | Done                   | One match opens the record (PR 9) and is selected (PR 12a); «Registrar pago» leads to the collector's open settlement (PR 7); bonds as ranges in a delivery (PR 16); the way from a frozen roster to the winners is a button (PR 16); empty states fit a phone (the list PRs, PR 11); an overdue installment says «Vencida» (PR 8, PR 12b) |

**Backend proposal B1 — Done (#197).** «Por cobrar» shows the buyer's address below the name and omits it when absent. `20270131000000_portal_due_buyer_address.sql` appends `buyer_address` to `portal_my_campaign_due_installments`; pgTAP `078_portal_due_buyer_address.test.sql` covers the existing active-own-sale scope.

## Still open

- **#162** (a payment date on the staff payment form) is still open on GitHub, although #163 added the date to the form and PR 7 kept it. It needs someone to confirm the rule with treasury and close it.
- **Backend proposals B2, B4 and B5** in [`direction.md`](direction.md#proposals-that-need-backend-or-business-changes) (search by name from the header, a payment from a bond with no open settlement, remembering the last collector): undecided, not started.
- **The screens that load bonds** (above, A10).
- **Decisions the PRs left for Santi and Juan**, with no answer written down yet: two Enters to add a payment (PR 7); a search by number that opens the record on a single match (PR 9); the amount prefilled as `10.000,00` in «Cobrar» (PR 10); «Falta cobrar» on the collector record counting payments in an open settlement while the sale record says «debe» until it closes (PR 15); the cash and commission cards leaving the campaign home (PR 13); the corrections needing JavaScript now that they are dialogs (PR 12b, PR 15, PR 16).
- **Follow-ups noted in the PRs and not done:** a `FilterBar` whose search is optional (the settlements and draws lists copy its chips); one pagination component (three lists carry a copy); type-checking `tests/e2e` (two specs broke on `main` without any check noticing); the pre-commit hook removing a lint directive in a fresh worktree.

## Not verified

- A campaign in closing or closed in the browser: the demo has none. Those states are covered by render tests.
- «Sin acceso al comprador / cobrador» on a screen: every fixture role can read collectors and buyers since #163, so the stand-ins are covered by unit and render tests only.
- Real use. Nobody has used the app yet; every number here comes from scripts on demo data.
