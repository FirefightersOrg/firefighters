# Imports and Barcode Entry

## Objective

Define how to enter bond, buyer, collector, and historical data without relying on manual one-by-one entry.

## Bond Entry by Barcode

Each physical bond contains a barcode. The system must be able to use it to speed up entry and search.

## Problem to Solve

It is not yet confirmed what data the barcode from the old system represents.

Possibilities:

- Visible base number.
- Internal bond identifier.
- External legacy code.
- Other undocumented value.

## Configuration per Campaign

The campaign must define how to interpret codes.

Suggested field:

```txt
barcode_mode
```

Values:

```txt
base_number
internal_code
external_legacy_code
manual_mapping
```

## Scan Entry Flow

```txt
Create entry session
↓
Select campaign
↓
Select entry type: simple bond or pata
↓
Scan barcode
↓
System interprets value per barcode_mode
↓
System calculates associated number if applicable
↓
System validates range and duplicates
↓
System adds item to preview
↓
User confirms batch
↓
System creates bonds and participating numbers
```

## Pata Entry by Scan

For patas, the system must allow grouping multiple scans into a single commercial unit.

```txt
Create pata
↓
Scan N base numbers
↓
System calculates N associated numbers
↓
System validates N commercial units
↓
System calculates pata value
↓
Confirm pata
```

## Import Sessions

Every bulk load must have a session.

Suggested fields:

- `id`
- `campaign_id`
- `source_type`
- `status`
- `created_by`
- `created_at`
- `confirmed_at`
- `notes`

Source types:

- `barcode_scan`
- `csv_file`
- `excel_file`
- `legacy_system_export`

Statuses:

- `draft`
- `validated`
- `confirmed`
- `cancelled`
- `failed`

## Validations

Before confirming a load, the system must validate:

- Number format.
- Range per campaign.
- Associated number within maximum.
- Duplicate participating number.
- Duplicate barcode.
- Incomplete pata.
- Already existing bond.
- Conflict with historical reservation if applicable.

## File Import

Initial suggested CSV format for bonds:

```csv
tipo_bono,grupo_pata,numero_base,barcode
simple,,1658,1658
simple,,0068,0068
pata,PATA1200,1200,PATA1200-1200
pata,PATA1200,1315,PATA1200-1315
```

Initial suggested CSV format for historical data:

```csv
collector_name,buyer_name,buyer_phone,number_value,campaign_name
Juan Perez,Diego Fernandez,1122334455,0068,2024-2025
```

## Preview

Before confirming, show:

- Total simple bonds.
- Total patas.
- Total base numbers.
- Total participating numbers.
- Blocking errors.
- Warnings.
- Duplicates.

## Confirmation

Confirmed import must create definitive data in a transaction when possible.

If it partially fails, the error must be recorded and no inconsistent data should remain.

## Functional Rollback

If an import was confirmed by mistake, it must not be silently deleted.

Rule:

```txt
Void import through audited process.
```

Voiding must mark created bonds as voided if they have no sales, payments, or settlements. If they already have operations, it requires specific administrative correction.

## Decisions (SAN-44 / SAN-45)

Schema: `20261123000000_campaign_barcode_pattern.sql`, `20261124000000_import_sessions.sql`, `20261125000000_operator_bond_scan.sql`. Details in `docs/data-model.md` (`import_sessions`, `import_session_items`, `bonds`, `bond_numbers`) and `docs/state-machines.md` (Import session).

- **Barcode modes.** `base_number`: the barcode is the base number. `manual_mapping`: the operator types the base number when scanning. `internal_code` / `external_legacy_code`: the campaign defines a regular expression (`campaigns.barcode_pattern`) whose first capture group is the base number; without a pattern they behave like `manual_mapping`. The pattern is a campaign rule: only for those two modes, validated by the database (compiles as a Postgres regex, has a capture group, at most 200 characters), editable only while the campaign is `draft` and frozen once it has bonds.
- **Sources.** `barcode_scan`, `csv_file`, `excel_file` (`legacy_system_export` is post-MVP). File imports use the columns `tipo_bono,grupo_pata,numero_base,barcode` (CSV and `.xlsx`; parsing in SAN-45) and keep the original file name on the session.
- **Staging.** Rows and scans are staged in `import_session_items`; erroneous rows are soft-removed (`removed_at`), never deleted. Sessions are never deleted either: they are cancelled, marked failed, or (once confirmed) rolled back.
- **Bonds only on confirmation.** Bonds are created when the session is confirmed, directly as `available` (never `created`), with `bonds.import_session_id` set (immutable). Each item records the bond it created. Confirmation certifies the mapping and completeness: one simple bond per simple item; one printed pata per `grupo_pata`, with one row per unit; no unlinked bond; and, per unit, the base and associated numbers with each row's base number (and its barcode for a pata row).
- **Patas and barcodes.** Rows sharing a `grupo_pata` form one printed pata: the pata bond's `barcode` is the `grupo_pata`, and each row's barcode is kept on its base number (`bond_numbers.barcode`). A barcode identifies one live thing per campaign across bonds and base numbers; codes are freed only when a bond is annulled from `available` (and its numbers are released), like participating numbers.
- **Confirmation (SAN-47).** `import_session_confirm(session_id, request_id)` requires the session's
  permission (`bond.import` for files, `bond.scan` for scans), a `validated` session and a `draft` or
  `active` campaign. It revalidates under lock: if a number or code was taken after validation, it
  returns the fresh summary with `confirmed: false` and the session goes back to `draft` (no bonds
  are created). Otherwise it creates every bond in one transaction and audits `import.confirm` plus
  one `bond.create` per bond (with `import_session_id`), so the bond record shows how it was loaded.
- **Rollback (SAN-47).** `import_session_rollback(session_id, reason, request_id)` annuls the
  import's bonds (`bond.annul`, admin only, reason required, campaign `draft` or `active`, only if
  every bond is still `available` and ungrouped), which frees their numbers and codes, and then
  marks the session as rolled back (it stays `confirmed`). It audits `import.rollback` on the
  session and one `bond.annul` per bond, with the same shape as a manual annulment.
- **Permissions.** Import data is readable with `bond.import` or `bond.scan`. The operator has both (`bond.scan` added in SAN-44).
- **Staging and validation (SAN-45).** `import_session_create`, `import_session_add_items`,
  `import_session_add_scan`, `import_session_remove_item`, `import_session_validate` and
  `import_session_cancel` are audited `SECURITY DEFINER` functions. File sessions require
  `bond.import`; scan sessions require `bond.scan`. A malformed API payload is rejected (`22023`);
  a business problem is retained as an `error` item so the preview can show it. Revalidation checks
  the campaign range (including the associated number), duplicate participating numbers and
  barcodes in the batch, live numbers/codes already held by the campaign, pata barcode/group rules,
  and the minimum two rows per pata group when validating. A clean session moves from `draft` to
  `validated`; editing it returns it to `draft`.
- **Scan resolution (SAN-45).** `base_number` parses the scanned code as the base number.
  `manual_mapping` requires the operator to type it. `internal_code` and
  `external_legacy_code` use the first capture group of `barcode_pattern`; without a pattern they
  behave as `manual_mapping`. Every scan remains a staged row, including an unrecognized one.

## App layer (SAN-45)

Code: `src/lib/domain/barcodes.ts`, `src/lib/domain/csv.ts`, `src/lib/domain/imports.ts`, `src/lib/server/imports/parse-file.ts`, `src/lib/schemas/import.ts`, `src/lib/server/repositories/imports.ts`, `src/lib/server/services/imports.ts`. It calls the functions of `20261126000000_import_staging.sql` and adds no SQL.

### Upload flow

`stageImportFile` parses the file, reads the campaign rules, interprets every row (`interpretImportRow`), creates the session (`import_session_create`), stages the rows in batches of 1,000 (`import_session_add_items`; each batch is its own transaction and `import.stage` audit row) and validates (`import_session_validate`). It returns the summary of `import_session_validate` (camelCase) plus `rowCount`. A file that cannot be read fails before anything is written.

### File format

- `.csv` or `.xlsx` (first worksheet). Excel 97-2003 `.xls` is not supported.
- Header row with the columns `tipo_bono,grupo_pata,numero_base,barcode`, in any order. Accepted aliases (case, accents, spaces and hyphens ignored): `tipo`, `tipo_de_bono`, `bond_type`, `type`, `kind`; `grupo`, `pata`, `grupo_de_pata`, `pata_group`, `group`, `group_key`; `numero`, `nro_base`, `base_number`, `number`, `base`; `codigo_barras`, `codigo_de_barras`, `codigo`, `bar_code`, `code`. Other columns are ignored.
- CSV: UTF-8 with or without BOM (invalid UTF-8 is read as Windows-1252), delimiter `,` or `;` (detected from the header), RFC 4180 quoting. Values are trimmed; blank rows are skipped.
- `.xlsx`: numeric cells with a zero-padding format (`0000`) keep their padding; other numbers are written plainly (68). Formulas use their cached result.
- Limits: 5 MB per file, 5,000 data rows per file, 500 characters per value.
- The row number of an item is the file row (header = row 1), so messages point at the spreadsheet row.

### Row interpretation (`interpretImportRow`)

The barcode is read per `barcode_mode` exactly like `import_session_add_scan` reads a scan (same codes and messages): `base_number` takes the barcode as the number (1 to 10 digits; `parse_code_not_a_number`), `manual_mapping` and the pattern modes without a pattern need `numero_base` (`parse_base_number_required`), the pattern modes take the first capture group (`parse_code_not_recognized`). The range is checked by the database (`number_out_of_range`). The first problem wins; a row with a `parse_*` error is staged without a base number.

| Code                          | When                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `parse_invalid_type`          | `tipo_bono` is not `simple` / `pata` (an empty type is left to the database: `missing_type`) |
| `parse_barcode_too_long`      | barcode over 200 characters                                                                  |
| `parse_simple_with_group`     | a simple row with `grupo_pata`                                                               |
| `parse_missing_group`         | a pata row without `grupo_pata` (staged without type: the database rejects such a payload)   |
| `parse_group_too_long`        | `grupo_pata` over 200 characters                                                             |
| `parse_invalid_base_number`   | `numero_base` is not 1 to 10 digits                                                          |
| `parse_code_not_a_number`     | `base_number` mode: the barcode is not a number                                              |
| `parse_code_not_recognized`   | pattern modes: no match, or the capture is not a number                                      |
| `parse_base_number_required`  | the barcode does not carry the number and `numero_base` is empty                             |
| `parse_base_number_mismatch`  | `numero_base` and the number in the barcode differ                                           |
| `parse_pattern_not_supported` | the campaign pattern cannot be applied in JavaScript (see below) and `numero_base` is empty  |

A row without barcode takes `numero_base`; a row with neither is left to the database (`missing_base_number`).

The pattern is a Postgres ARE. JavaScript `RegExp` applies it only when it stays inside the common subset (literals, `^ $ . \d \s`, bracket expressions like `[0-9A-Z]`, `(...)`, `(?:...)`, `(?=...)`, alternation, greedy quantifiers, `{m,n}`). Patterns using `\b` (a backspace in ARE), `\y \m \M \A \Z`, POSIX classes (`[[:digit:]]`), `***` directors, embedded options `(?i)`, lookbehind, lazy quantifiers or back references are not applied by the app: such file rows need `numero_base` (scans are resolved by the database).

### Instant preview (`validateImportBatch`)

A pure mirror of `import_session_revalidate` + `import_session_check_groups` over the live rows, with the same codes, messages and precedence: `parse_*` (kept) → `missing_type` → `missing_base_number` → `missing_barcode` (pata) → `missing_group` → `number_out_of_range` → `number_conflict` → `number_in_use` → `duplicate_barcode` → `barcode_in_use` (row barcode, then pata code) → `duplicate_barcode` (pata code used as a row barcode) → `incomplete_pata` (only when validating). Without the campaign's live data it skips the `*_in_use` checks. `summarizeImportItems` gives the counts of `import_session_summary`. The database is authoritative; `tests/integration/import-staging.test.ts` checks that both agree on every row, message and count.
