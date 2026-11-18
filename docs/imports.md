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

## Decisions (SAN-44)

Schema: `20261123000000_campaign_barcode_pattern.sql`, `20261124000000_import_sessions.sql`, `20261125000000_operator_bond_scan.sql`. Details in `docs/data-model.md` (`import_sessions`, `import_session_items`, `bonds`, `bond_numbers`) and `docs/state-machines.md` (Import session).

- **Barcode modes.** `base_number`: the barcode is the base number. `manual_mapping`: the operator types the base number when scanning. `internal_code` / `external_legacy_code`: the campaign defines a regular expression (`campaigns.barcode_pattern`) whose first capture group is the base number; without a pattern they behave like `manual_mapping`. The pattern is a campaign rule: only for those two modes, validated by the database (compiles as a Postgres regex, has a capture group, at most 200 characters), editable only while the campaign is `draft` and frozen once it has bonds.
- **Sources.** `barcode_scan`, `csv_file`, `excel_file` (`legacy_system_export` is post-MVP). File imports use the columns `tipo_bono,grupo_pata,numero_base,barcode` (CSV and `.xlsx`; parsing in SAN-45) and keep the original file name on the session.
- **Staging.** Rows and scans are staged in `import_session_items`; erroneous rows are soft-removed (`removed_at`), never deleted. Sessions are never deleted either: they are cancelled, marked failed, or (once confirmed) rolled back.
- **Bonds only on confirmation.** Bonds are created when the session is confirmed, directly as `available`, with `bonds.import_session_id` set (immutable). Each item records the bond it created.
- **Patas and barcodes.** Rows sharing a `grupo_pata` form one printed pata: the pata bond's `barcode` is the `grupo_pata`, and each row's barcode is kept on its base number (`bond_numbers.barcode`). A barcode identifies one live thing per campaign across bonds and base numbers; codes are freed only when a bond is annulled from `available` (and its numbers are released), like participating numbers.
- **Rollback (SAN-47).** Rolling back a confirmed import annuls its bonds (`bond.annul`, admin only, reason required, only if none was delivered, sold or grouped), which frees their numbers and codes, and then marks the session as rolled back (it stays `confirmed`).
- **Permissions.** Import data is readable with `bond.import` or `bond.scan`. The operator has both (`bond.scan` added in SAN-44).

## Staging and validation (SAN-45)

Code: `src/lib/domain/barcodes.ts`, `src/lib/domain/csv.ts`, `src/lib/domain/imports.ts`, `src/lib/server/imports/parse-file.ts`, `src/lib/server/services/imports.ts`. Database: `20261126000000_import_staging_rpcs.sql` (pgTAP `012_import_staging.test.sql`).

### Barcode interpretation

| `barcode_mode`                                                  | Base number                                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base_number`                                                   | The barcode itself: ASCII digits, at most `number_digits` (zero padding allowed: `0068` and `68` are 68).                                                           |
| `manual_mapping`                                                | From `numero_base` (typed by the operator or in the file). The barcode is only stored.                                                                              |
| `internal_code` / `external_legacy_code` with `barcode_pattern` | The first capture group of `regexp_match(barcode, barcode_pattern)` (same digit rule). No match, or a group that does not take part, is `barcode_pattern_mismatch`. |
| `internal_code` / `external_legacy_code` without pattern        | Like `manual_mapping`.                                                                                                                                              |

`numero_base` may be empty when the barcode carries the number; when both are present they must be the same number (`base_number_mismatch`).

The pattern is a Postgres ARE. The database applies it and decides. The app applies it with JavaScript `RegExp` only when the pattern stays inside the common subset (literals, `^ $ . \d \s`, bracket expressions like `[0-9A-Z]`, `(...)`, `(?:...)`, `(?=...)`, alternation, greedy quantifiers, `{m,n}`). Patterns using `\b` (a backspace in ARE), `\y \m \M \A \Z`, POSIX classes (`[[:digit:]]`), `***` directors, embedded options `(?i)`, lookbehind, lazy quantifiers or back references are not applied client-side: the preview shows those items as `pending`. Known remaining difference: `\d` and `\w` may match non-ASCII digits/letters in Postgres; such a capture still fails the ASCII digit rule on both sides, but the code can differ (`invalid_barcode` in the database, `barcode_pattern_mismatch` in the app).

### File format

- `.csv` or `.xlsx` (first worksheet). Excel 97-2003 `.xls` is not supported.
- Header row with the columns `tipo_bono,grupo_pata,numero_base,barcode`, in any order. Accepted aliases (case, accents, spaces and hyphens ignored): `tipo`, `tipo_de_bono`, `bond_type`, `type`, `kind`; `grupo`, `pata`, `grupo_de_pata`, `pata_group`, `group`, `group_key`; `numero`, `nro_base`, `base_number`, `number`, `base`; `codigo_barras`, `codigo_de_barras`, `codigo`, `bar_code`, `code`. Other columns are ignored.
- CSV: UTF-8 with or without BOM (invalid UTF-8 is read as Windows-1252), delimiter `,` or `;` (detected from the header), RFC 4180 quoting. Values are trimmed; blank rows are skipped.
- `.xlsx`: numeric cells with a zero-padding format (`0000`) keep their padding; other numbers are written plainly (68). Formulas use their cached result.
- Limits: 5 MB per file, 5000 data rows per file and 5000 live items per session, 500 characters per value, 200 characters per barcode / pata group (longer is a row error).
- `tipo_bono` is `simple` or `pata` (case-insensitive). Rows sharing `grupo_pata` form one pata (N >= 2); the pata bond's barcode will be the `grupo_pata` and each row's barcode stays with its base number. A simple row has no `grupo_pata`.
- `barcode` is required on every row (scan or file).
- The row number of an item is the file row (header = row 1), so messages point at the spreadsheet row.

### Item statuses and codes

Staged and corrected items are `pending`. `import_session_validate` gives each live item one status. The first matching error wins, in this order:

| Code                                                                 | When                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `missing_type`, `invalid_type`                                       | `tipo_bono` empty or not `simple` / `pata`                                                   |
| `missing_barcode`, `barcode_too_long`                                | no barcode, or more than 200 characters                                                      |
| `simple_with_group`, `missing_group`, `group_too_long`               | simple row with `grupo_pata`; pata row without it; group code over 200 characters            |
| `invalid_barcode`, `barcode_pattern_mismatch`                        | the barcode cannot give a base number in this mode                                           |
| `invalid_base_number`, `missing_base_number`, `base_number_mismatch` | `numero_base` malformed, needed but empty, or different from the barcode's number            |
| `out_of_range`, `overflow`                                           | number above `max_number`; associated number above `max_number`                              |
| `pata_incomplete`                                                    | a `grupo_pata` with fewer than 2 rows that pass the checks above                             |
| `duplicate_number_in_batch`                                          | a base or associated number used twice among the session's live items (also inside one pata) |
| `duplicate_barcode_in_batch`                                         | a code used twice in the session; row barcodes and pata group codes share one namespace      |
| `duplicate_number_in_campaign`                                       | a participating number held by a live bond of the campaign                                   |
| `duplicate_barcode_in_campaign`                                      | a code held by a live bond or base number of the campaign                                    |

Warnings do not block validation. There is one: `base_number_not_padded`, when `numero_base` (or, in `base_number` mode, the barcode) has fewer digits than the campaign uses (`68` in a 4-digit campaign), typically a spreadsheet that dropped leading zeros. The message shows the number that will be used (`read as 0068`). Pattern captures are not checked.

The session moves to `validated` only when no live item is in error; otherwise it stays `draft` with the errors written on the items. Correcting, adding or removing an item of a validated session returns it to `draft`.

Preview summary (live items): `total_items`, `valid`, `warnings`, `errors`, `simple_bonds` (accepted simple rows), `patas` (distinct groups among accepted pata rows), `base_numbers` (accepted rows), `participating_numbers` (2 × base numbers), `duplicates` (items whose error is a duplicate). "Accepted" = `valid` or `warning`: once validated, the summary is what confirmation creates.

### Decisions (SAN-45)

- Staging functions are permission-checked per session source: `bond.scan` for `barcode_scan`, `bond.import` for files (operator and admin have both). Every successful call writes one `audit_log` row (`import.create`, `import.add_items` with counts, `import.add_item`, `import.update_item`, `import.remove_item`, `import.cancel`, `import.validate` with the summary); rejected calls write nothing.
- File rows are added in bulk (`import_session_add_items`); scans one at a time (`import_session_add_scan`, row number = next in the session). A correction (`import_session_update_item`) replaces the four fields; `raw_value` keeps what the source said.
- The database validation is authoritative and is a snapshot: a bond created after validation is caught again when confirming (SAN-47), where the unique indexes have the final word.
- The TypeScript validator uses the same rules, codes and messages; the integration test compares both on the same rows and live data.
- Bonds are not created here (SAN-47).
