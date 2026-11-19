# Phase 9 verification: commissions and collector ledger (SAN-70)

Evidence: `tests/integration/phase-9-acceptance.test.ts`, run against the local Supabase stack as
real users (seeded admin and read-only). Fixtures: a 2-installment campaign; collectors A and B; a
general `installment_first` 10% rule; and a special `installment_first` 20% rule for collector A.

| #   | Criterion                                                                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Special per-collector rules override general rules within their validity window            | A 30,000 first-installment payment gives a preliminary commission of 6,000 (20%) for A and 3,000 (10%) for B. Precedence order: SAN-68 `settlement_application_commission`, pgTAP 031/032.                                                                                                                                                                                                                   |
| C2  | Closing a settlement creates accurate `collector_ledger_entries`                           | Closing A's cash settlement posts `commission_generated` / credit 6,000 and `commission_settled` / debit 6,000 (commission retained from cash), so the balance is 0. Stored totals: `commission_paid_amount` 6,000, `net_to_firefighters` 24,000.                                                                                                                                                            |
| C3  | Transfer payments generate collector commission credit until settled                       | A transfer settlement posts only `commission_generated` 6,000 (`commission_paid_amount` 0, net 30,000), which leaves a 6,000 balance. `commission_settle` 2,500 brings it to 3,500 and is audited. Settling more than the balance is rejected (22023).                                                                                                                                                       |
| C4  | Manual adjustments require authorization and a mandatory reason, and write `audit_log`     | Read-only gets 42501 on `commission_adjust` and on `collector_ledger_adjust`, and a blank reason gets 22023. A 500 adjustment in favor of Firefighters writes the difference row, a debit and a `commission.adjust` audit row with its reason; the special rule keeps 20%. A ledger credit of 100 is annulled (audited `collector_ledger.annul`). Entries of a closed settlement cannot be annulled (55000). |
| C5  | Balance = sum(non-annulled credit) − sum(non-annulled debit), with no manual balance field | Rebuilding the balance from the entries (skipping the annulled one) gives 3,000, which matches `collector_ledger_balance` and the last running balance of `collector_ledger_entries_with_balance`. `collectors` has no balance column.                                                                                                                                                                       |

## Decisions and known gaps

- `cash_settled` and `transfer_received_by_firefighters` rows are not posted at close: a single
  positive row would move the commission balance. The cash/transfer trail is the payments and the
  settlement snapshot (SAN-68, `docs/commissions.md`).
- Editing a rule already applied by a closed settlement is not blocked yet (follow-up in
  `docs/commissions.md`).
- Rule validity is not limited to the campaign dates (follow-up).
- When this branch meets SAN-66 (#64), the phase-8 acceptance test needs its expectations for
  `commission_paid_amount` / `net_to_firefighters` updated to the SAN-68 meaning.
