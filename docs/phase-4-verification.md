# Phase 4 verification (SAN-48)

Verified against local Supabase using the seeded admin, operator and read-only users. The live acceptance suite is `tests/integration/phase-4-acceptance.test.ts`; it calls the real SvelteKit loads/actions for `/campaigns/[id]/bonds/import`, `/campaigns/[id]/bonds/import/[sessionId]` and `/campaigns/[id]/bonds/scan`, plus their real import services and SQL functions. Each run tags its own campaigns as `[it-p4 <run id>]`, so nothing is deleted and reruns do not collide.

## Acceptance criteria

| #   | Criterion                                                                                                                                                            | Evidence                                                                                 | Result                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scan, CSV and XLSX staging creates sessions/items but no bonds/numbers before confirmation                                                                           | Integration §1; service-role reads of `import_sessions`, `import_session_items`, `bonds` | **Pass** — one scan, CSV and generated XLSX each stage one item; all have zero bonds before confirm.                                                                                            |
| 2   | `base_number`, pattern `internal_code`/`external_legacy_code`, pattern-less `internal_code`/`external_legacy_code` and `manual_mapping` resolve rows/scans correctly | Integration §2; `barcodes.ts` / `interpretImportRow` path                                | **Pass** — base, `^IT-([0-9]{4})$`, `^EX-([0-9]{4})$`, no-pattern manual fallback and manual mapping all store their expected base; base barcode/file mismatch is `parse_base_number_mismatch`. |
| 3   | Blocking range, duplicate and incomplete-pata errors stop confirmation and preview correction/removal resolves them                                                  | Integration §3                                                                           | **Pass** — 409/no bonds until update plus remove operations leave a validated session.                                                                                                          |
| 4   | Preview metrics equal authoritative staged-item counts                                                                                                               | Integration §4; service-role `import_session_items`                                      | **Pass** — live rows, simple rows, pata groups, unique base/participating numbers, errors and duplicates are compared to staged data.                                                           |
| 5   | Confirmation is transactional, builds simple/pata numbers, audits, and rejects stale sessions                                                                        | Integration §5; service-role `bonds`, `bond_numbers`, `audit_log`                        | **Pass** — one simple plus one pata yields 2 bonds/6 numbers, one `import.confirm` and two `bond.create` entries; a number taken after validation returns 409 and creates none.                 |
| 6   | Rollback is audited/admin-only, releases available numbers, skips hand-annulled and blocks delivered bonds                                                           | Integration §6                                                                           | **Pass** — operator 403, missing admin reason 400, released number reimports, manually annulled bond is skipped, delivered bond returns 409.                                                    |
| 7   | Users without `bond.import`/`bond.scan` (read-only, treasurer) are denied; sessions keep their source (per-source split: pgTAP `011`/`012`)                          | Integration §7; pgTAP `012`                                                              | **Pass** — read-only import/scan loads return 403; scan and CSV preview their respective source types.                                                                                          |

## Commands and results

| Check         | Command                                  | Result                                                                                                                                                                                                    |
| ------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install       | `CI=true pnpm install --frozen-lockfile` | Pass.                                                                                                                                                                                                     |
| Type check    | `pnpm check`                             | 0 errors, 0 warnings.                                                                                                                                                                                     |
| Lint / format | `pnpm lint`                              | Pass.                                                                                                                                                                                                     |
| Unit tests    | `pnpm test`                              | **1070/1070 pass** in 58 files.                                                                                                                                                                           |
| Integration   | `APP_ENV=local pnpm test:integration`    | **126/126 pass** in 10 files (including the 7 Phase 4 acceptance criteria).                                                                                                                               |
| pgTAP         | `supabase test db`                       | **Known failure:** `003_rls_has_permission.test.sql` fails 7/107 because seeded users/data are present; remaining 14 files pass (1290/1297 assertions). This is tracked for another PR; no reset was run. |
| Browser check | Manual browser verification              | **Not run in this verification; manual check done during SAN-46 (#39)**.                                                                                                                                  |

## Test data and re-runs

The suite never deletes campaigns, sessions, items, bonds or numbers. `RUN_ID` combines a timestamp and UUID, and request ids use the same run prefix. Assertions query only session and campaign ids created by the running suite.

## Findings

No product bug was found during this verification.

## Not verified here

Hooks/cookies are represented by route-event locals as in the earlier acceptance suites. Browser interaction was not repeated; see the SAN-46 manual check above.
