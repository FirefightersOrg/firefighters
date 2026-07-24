# Domain Layer (`src/lib/domain/`)

Pure, framework-agnostic domain models, calculations, and business validation rules.

## Modules

- `numbering.ts`: Number formatting (4/5 digits), offset calculations (`base_number + offset`), and validation.
- `bonds.ts`: Bond calculations, pata composition, and duplicate checks.
- `commissions.ts`: Preliminary and confirmed commission calculation logic.
- `draws.ts`: Draw eligibility calculations and roster filtering logic.
