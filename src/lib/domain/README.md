# Domain Layer (`src/lib/domain/`)

Pure, framework-agnostic domain models, calculations, and business validation rules.

## Conventions

- No Supabase, Svelte or SvelteKit imports: plain TypeScript only, unit-tested with colocated `*.test.ts` files.
- Invalid input raises a subclass of `DomainError` (from `errors.ts`) whose `code` callers map to user-facing messages.

## Modules

- `errors.ts`: `DomainError` base class (stable `code` + message) for business-rule violations.
- `numbering.ts`: Per-campaign numbering (`CampaignNumberingConfig`, `DEFAULT_NUMBERING_CONFIG` = 4 digits / max 9999 / offset 4871 / `reject`). Formatting and parsing with leading zeros (`formatCampaignNumber`, `parseCampaignNumber`; digit count always comes from the config), associated number (`calculateAssociatedNumber` = base + offset, throws `NumberingError` on overflow), range/overflow checks (`validateNumberRange`, `validateNoOverflow`, `getMaxValidBaseNumber`), and config validation mirroring the `campaigns` DB constraints (`validateNumberingConfig`, `assertValidNumberingConfig`).
- `bonds.ts`: Bond calculations, pata composition, and duplicate checks.
- `commissions.ts`: Preliminary and confirmed commission calculation logic.
- `draws.ts`: Draw eligibility calculations and roster filtering logic.
