# Phase 13 verification: reports and exports work without Excel (SAN-88)

Evidence is `tests/integration/phase-13-acceptance.test.ts` (42 tests) plus the reports routes added to
`tests/e2e/a11y.spec.ts`. The integration file runs against the local Supabase with the five seeded
roles, through the real route loads (`/campaigns/[id]`, `/reports`, `/reports/financial`) and the real
export endpoint (`/reports/export/[report]`). One fixture is built in `beforeAll` and only read by the
tests, so the tests are independent and order-free (the file also passes shuffled). Dates are relative to
the Buenos Aires today and the campaign ends in 2099: nothing in the fixture expires.

Fixture (main campaign, bond 300.00 in 3 installments, 10% first-installment commission rule): four
bonds (1 available, 1 delivered, 2 sold), a cash payment of 100.00 dated 20 days ago and a transfer of
100.00 dated today in one closed settlement (commission 20.00), a frozen-roster draw whose prize is won
by bond 7, and a buyer whose name starts with `=`. A second campaign (250.00 cash, its own draw) and an
empty campaign prove scoping.

| Criterion                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard reconciles with confirmed records | C1: bonds, revenue (expected 600.00, collected 200.00, pending 400.00, 33%), cash, transfer and settlement counts match the fixture; dashboard cash equals the sum of confirmed `payments` read independently, and the bond total equals a direct count of `bonds`. The other and the empty campaign show their own figures.                                                                                                                                                                                                                                                                                           |
| Reports filter and export cleanly           | C2, C3: operational reports (status matrix, by collector with the unassigned row, installments, monthly) and financial and draw reports (payments by date, settlements, accounts, rosters, prizes) with collector, status, inclusive date-range and method filters. C4: all 10 exports in CSV (BOM, parsed with an independent RFC 4180 reader) and xlsx (read with exceljs): same headers, same row count, numeric columns are exact decimals in CSV and numbers in Excel, filters apply to the export, formulas in free text are prefixed with `'` in both formats, a missing collector/draw or a bad format is 400. |
| Consistency                                 | C5: the collected 200.00 is identical in the payments report, settlements report, dashboard cash, dashboard revenue, monthly report, paid installments, and the CSV/xlsx of payments, settlements, monthly and installments. Bond count and value agree across bonds-by-status, bonds-by-collector, the dashboard and their CSV. The ledger CSV agrees with the account report (entry count, closing balance) and the settlement commission is 20.00.                                                                                                                                                                  |
| Permissions across 5 roles                  | C6: admin, treasurer and read-only read and export everything; operator reads and exports only operational reports (403 on the financial page and on every financial export); collector gets 403 on every page and export. Refusals contain no fixture data. The dashboard hides the groups the role cannot see (collector sees none). The `report_*` functions refuse operator and collector in the database. `permissions = null` is 500 on every page, export and the dashboard.                                                                                                                                    |
| Campaign scoping                            | C7: unknown and malformed campaign ids are 404 on all pages, the dashboard and exports; a draw of another campaign is 404 in the page and in the roster export; exports of the main campaign contain nothing of the other campaign.                                                                                                                                                                                                                                                                                                                                                                                    |
| Buenos Aires dates                          | C8: `todayInBuenosAires` at the 03:00 UTC boundary; the export file name uses the Buenos Aires day when UTC is already the next day (fake clock 02:30 UTC); payments keep their own dates; ledger rows are dated and timed in Buenos Aires, compared with an independent `Intl` conversion of the stored instants.                                                                                                                                                                                                                                                                                                     |

## Known gaps

- **SAN-139 / SAN-140:** there is no collector-coordinator role, so reports and the dashboard are not
  scoped per coordinator. Only the five seeded roles are verified.
- **SAN-142:** the overdue warning is not covered here.
- **Dashboard at-risk list and next draw** are covered by `campaign-dashboard.test.ts` (SAN-85), not
  repeated in this file.
- **Excel itself is never opened:** CSV is parsed and xlsx is read with exceljs; how a real Excel or
  LibreOffice renders them (locale, column widths, number formats) is not tested.
- **Exports use English headers and labels** (`Commercial status`, `Cash`); the screens are Spanish.
- **Large data:** the fixture has a handful of rows. Paging (`REPORT_PAGE_SIZE` 1000, roster page limit 500) and performance are not exercised end to end.
- **Corrected or annulled settlements and payments** are not in the fixture, so their effect on every
  report and on the dashboard is not verified here.
- **Accessibility:** the reports routes are in the axe and 375px checks (light and dark); the keyboard
  flow of the report filters is not tested.

## Validation

Run after `supabase db reset --local` and `seed:admin`, inside one DB lock: `supabase test db` (56
files, 3392 tests), the full integration suite (32 files, 299 tests), the phase-13 file shuffled twice
(42 tests each), then `pnpm check`, `pnpm lint`, `pnpm test` (166 files, 2154 tests) and `pnpm build`.
The Playwright suite (184 tests, including the new reports routes in light and dark at 1280px and 375px) passes. Adding the routes found a real defect: the "Reportes financieros y de sorteos" link on the operational reports page was 20px tall at 375px; it now has a 44px target.
