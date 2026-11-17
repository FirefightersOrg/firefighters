# Domain Layer (`src/lib/domain/`)

Pure, framework-agnostic domain models, calculations, and business validation rules.

## Conventions

- No Supabase, Svelte or SvelteKit imports: plain TypeScript only, unit-tested with colocated `*.test.ts` files.
- Invalid input raises a subclass of `DomainError` (from `errors.ts`) whose `code` callers map to user-facing messages.

## Modules

- `errors.ts`: `DomainError` base class (stable `code` + message) for business-rule violations.
- `numbering.ts`: Per-campaign numbering (`CampaignNumberingConfig`, `DEFAULT_NUMBERING_CONFIG` = 4 digits / max 9999 / offset 4871 / `reject`). Formatting and parsing with leading zeros (`formatCampaignNumber`, `parseCampaignNumber`; digit count always comes from the config), associated number (`calculateAssociatedNumber` = base + offset, throws `NumberingError` on overflow), range/overflow checks (`validateNumberRange`, `validateNoOverflow`, `getMaxValidBaseNumber`), and config validation mirroring the `campaigns` DB constraints (`validateNumberingConfig`, `assertValidNumberingConfig`).
- `numbering-preview.ts`: `buildNumberingPreview(config)` for the live numbering preview and the campaign summary: example `base → associated` pairs, highest usable base, usable base count, first overflowing base, or the config problems (never throws).
- `money.ts`: Exact money. Canonical form (DB/SQL) is a two-decimal string (`"60000.50"`), arithmetic in integer cents. People type and read Argentine format: `parseMoneyInput` (with a comma, `,` is the decimal separator and `.` only groups thousands; without a comma, `.` groups thousands when every group has exactly 3 digits, and a single `.` followed by 1-2 digits is a decimal point; anything else is rejected) and `formatMoney` (`"$ 60.000,50"`, deterministic, matches `Intl` es-AR). Use these for every money input and display.
- `installments.ts`: Exact installment split (`splitIntoInstallments`) and the live preview of the form inputs (`previewInstallmentValue`).
- `bonds.ts`: Bond rules (SAN-23): participating numbers of N base numbers (`participatingNumberPairs`), numbers repeated inside a bond (`findIntraBondCollisions`, `validateBondNumbers`), campaign-wide conflicts against live numbers (`findCampaignConflicts`, `assertNoCampaignConflicts`), exact value `simple_bond_value * N` (`bondTotalValueCents`), printed bond / pata composition (`composePrintedBond`) and manual grouping rules (`validateManualGrouping`). Errors are `BondError` with the offending number padded to the campaign's digits.
- `commissions.ts`: Preliminary and confirmed commission calculation logic.
- `draws.ts`: Draw eligibility calculations and roster filtering logic.
