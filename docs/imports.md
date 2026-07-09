# Imports and Barcode Loading

## Objective

Define how to enter bond, buyer, collector, and historical data without depending on one-by-one manual entry.

## Bond Loading by Barcode

Each physical bond contains a barcode. The system must be able to use it to speed up loading and search.

## Problem to Solve

It is still not confirmed what data the old system barcode represents.

Possibilities:

- Visible base number.
- Internal bond identifier.
- External legacy code.
- Another undocumented value.

## Configuration by Campaign

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

## Loading Flow by Scan

```txt
Create loading session
↓
Select campaign
↓
Select loading type: simple bond or pata (multi-number bond/package)
↓
Scan barcode
↓
System interprets the value according to barcode_mode
↓
System calculates associated number if applicable
↓
System validates range and duplicates
↓
System adds item to preview
↓
User confirms batch
↓
System creates bonds and participant numbers
```

## Pata Loading by Scan

For patas, the system must allow grouping several scans into the same commercial unit.

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
- Range according to campaign.
- Associated number within the maximum.
- Duplicate participant number.
- Duplicate barcode.
- Incomplete pata.
- Existing bond.
- Conflict with historical reservation if applicable.

## Import from File

Suggested initial CSV format for bonds:

```csv
bond_type,pata_group,base_number,barcode
simple,,1658,1658
simple,,0068,0068
pata,PATA1200,1200,PATA1200-1200
pata,PATA1200,1315,PATA1200-1315
```

Suggested initial CSV format for historical records:

```csv
collector_name,buyer_name,buyer_phone,number_value,campaign_name
Juan Perez,Diego Fernandez,1122334455,0068,2024-2025
```

## Preview

Before confirming, show:

- Total simple bonds.
- Total patas.
- Total base numbers.
- Total participant numbers.
- Blocking errors.
- Warnings.
- Duplicates.

## Confirmation

A confirmed import must create final data in a transaction whenever possible.

If it partially fails, the error must be recorded and inconsistent data must not be left behind.

## Functional Rollback

If an import was confirmed by mistake, it must not be silently deleted.

Rule:

```txt
Void import through an audited process.
```

The voiding must mark created bonds as voided if they have no sales, payments, or collector settlements. If they already have operations, a specific administrative correction is required.
