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
